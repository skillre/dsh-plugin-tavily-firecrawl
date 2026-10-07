/**
 * `KeyPool`: multi-credential rotation shared by the Tavily and Firecrawl
 * providers. One pool owns one provider's credential list plus the runtime
 * bookkeeping that keeps a request from landing on a key the API has already
 * refused:
 *
 *   - selection is round-robin over the keys that are currently usable, so
 *     several accounts spread the load instead of hammering the first one;
 *   - a refusal is classified (`invalid` | `rate` | `quota`) and takes that key
 *     out of rotation for a cooldown while the caller retries on the next key;
 *   - a quota cooldown escalates (30m, 1h, 2h … capped), because a plan limit
 *     is rarely honored again inside the same billing window, while an invalid
 *     credential is dropped for the rest of the process.
 *
 * Nothing here touches the network or knows any provider: providers classify
 * HTTP statuses with {@link classifyHttpStatus} and report the outcome back.
 * @module @skillre/dsh-plugin-tavily-firecrawl/key-pool
 */
/** Cooldown applied after a rate-limit response (HTTP 429). */
export declare const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60000;
/** First cooldown applied after a plan/quota refusal (HTTP 402/403/432/433). */
export declare const DEFAULT_QUOTA_COOLDOWN_MS = 1800000;
/** Ceiling the escalating quota cooldown stops at. */
export declare const DEFAULT_QUOTA_COOLDOWN_MAX_MS = 86400000;
/** Failure classes a pool understands. */
export declare const KEY_FAILURE: {
    /** The credential itself was rejected (HTTP 401): dead for this process. */
    readonly INVALID: "invalid";
    /** Short-term throttle (HTTP 429): fixed short cooldown. */
    readonly RATE: "rate";
    /** Plan usage limit (HTTP 402/403/432/433): escalating cooldown. */
    readonly QUOTA: "quota";
};
/** A {@link KEY_FAILURE} value. */
export type KeyFailureKind = (typeof KEY_FAILURE)[keyof typeof KEY_FAILURE];
/** A retryable but key-neutral failure (HTTP 5xx): rotate without blaming the key. */
export declare const TRANSIENT_FAILURE = "transient";
/** A {@link KEY_FAILURE} value or {@link TRANSIENT_FAILURE}. */
export type AttemptKind = KeyFailureKind | typeof TRANSIENT_FAILURE;
/**
 * One key-scoped attempt failure: the API answered, and the answer blames the
 * credential (or is transient) rather than the request. Providers throw this
 * from a single attempt; the rotation loop decides whether to continue on
 * another key.
 */
export declare class AttemptFailure extends Error {
    /** The HTTP status the provider API answered with. */
    readonly status: number;
    /** A {@link KEY_FAILURE} value, {@link TRANSIENT_FAILURE}, or `undefined` for a request-level error that no other key can fix. */
    readonly kind: AttemptKind | undefined;
    /** Whether another key may succeed where this one failed. */
    readonly retryable: boolean;
    /**
     * @param status - the HTTP status the provider API answered with.
     * @param kind - a {@link KEY_FAILURE} value, {@link TRANSIENT_FAILURE}, or `undefined` for a request-level error that no other key can fix.
     * @param message - the API's own explanation, already truncated.
     */
    constructor(status: number, kind: AttemptKind | undefined, message: string);
}
/**
 * What {@link rotationMessage} needs from one attempt failure. `AttemptFailure`
 * satisfies it; tests and callers may hand over any error carrying the same
 * three readings, as the pre-rotation code did.
 */
export interface AttemptFailureLike {
    /** The HTTP status the provider API answered with. */
    readonly status: number;
    /** A {@link KEY_FAILURE} value, {@link TRANSIENT_FAILURE}, or `undefined`. */
    readonly kind: string | undefined;
    /** The API's own explanation. */
    readonly message: string;
}
/** One attempt of one call, paired with the credential that made it. */
export interface RotationFailure {
    /** The pool entry the attempt used. */
    readonly entry: KeyPoolEntry;
    /** Why the attempt failed. */
    readonly error: AttemptFailureLike;
}
/**
 * A live credential list a provider consults synchronously and refreshes
 * asynchronously. Implemented by the credentials-backed source; tests may
 * hand a provider any object of this shape.
 */
export interface KeySource {
    /** The keys in force as of the last refresh. */
    current(): readonly string[];
    /** Whether the first credentials read has not settled yet, so a pool verdict would be premature. */
    isWarming(): boolean;
    /** Re-read the credential plane; resolves with the keys now in force. */
    refresh(): Promise<readonly string[]>;
}
/** The credential material a provider instance is built from. */
export interface CredentialOptions {
    /** One credential (legacy single-key form). */
    readonly apiKey?: string | undefined;
    /** The credential pool; wins over `apiKey`. */
    readonly apiKeys?: readonly string[] | undefined;
    /**
     * Live credential source; when present it owns the list entirely (including
     * any configured keys) and is refreshed at request start.
     */
    readonly keySource?: KeySource | undefined;
}
/**
 * The credential list a provider instance should rotate over. A live
 * {@link KeySource} owns the list when one is configured; otherwise `apiKeys`
 * wins over the legacy single `apiKey` and blanks are dropped by the pool.
 * @param options - provider options.
 * @returns the candidates.
 */
export declare function collectKeys(options?: CredentialOptions | undefined): readonly string[];
/**
 * Classify one provider-API HTTP status for key rotation.
 * @param status - the HTTP status the provider API answered with.
 * @returns a {@link KEY_FAILURE} value or {@link TRANSIENT_FAILURE} to retry on the next key; `undefined` when the status is not a credential or availability problem at all (a malformed request), which must surface as-is.
 */
export declare function classifyHttpStatus(status: number): AttemptKind | undefined;
/**
 * Split one environment value into a key list. Multi-key values are written
 * with any mix of commas, semicolons, and whitespace (including newlines), so
 * `TAVILY_API_KEYS=tvly-a,tvly-b` and a multi-line value both work.
 * @param value - the raw environment value.
 * @returns the non-empty, trimmed keys in first-seen order.
 */
export declare function parseKeyList(value: unknown): string[];
/** Shortest credential whose masked tail still hides at least as much as it shows. */
export declare const MASK_MIN_KEY_LENGTH = 20;
/**
 * Build the display label for one credential: its 1-based position plus a
 * masked tail. Error messages and diagnostics name keys this way, so a
 * multi-account setup can be told apart without printing a usable secret.
 *
 * The tail is shown only when at least as many characters stay hidden as are
 * printed: a short secret would otherwise be nearly reconstructed by the mask
 * itself (an 11-character key with a fixed 6+4 mask reveals 10 of its 11
 * characters), so anything at or below {@link MASK_MIN_KEY_LENGTH} is named by
 * position alone.
 * @param key - the credential.
 * @param index - its zero-based position in the pool.
 * @returns e.g. `#2 (tvly-d…cdef)`, or plain `#2` for short values.
 */
export declare function maskKey(key: string, index: number): string;
/**
 * Normalize one provider endpoint base: a configured trailing slash would
 * otherwise concatenate into `//search` / `//v1/scrape` and turn a working
 * endpoint into a 404. Only trailing slashes are removed, so the value is
 * still the operator's own (including an unusable one, which `available()`
 * keeps rejecting).
 * @param baseURL - the configured endpoint base.
 * @returns the base without trailing slashes.
 */
export declare function trimBaseURL(baseURL: string): string;
/**
 * Render a cooldown for a human reading a tool error.
 * @param ms - milliseconds; `Infinity` means "never".
 * @returns e.g. `42s`, `5m`, `2.5h`, `1.2d`, `never`.
 */
export declare function formatWait(ms: number): string;
/** One credential plus the bookkeeping the pool keeps about it. */
export interface KeyPoolEntry {
    /** The credential itself. */
    readonly key: string;
    /**
     * The masked display label used in error messages. Re-derived on
     * {@link KeyPool.reconcile}, because a label names a key's position and
     * positions shift when the credential list changes.
     */
    label: string;
    /** True once the API rejected the credential itself (HTTP 401). */
    dead: boolean;
    /** Epoch milliseconds until which the key is out of rotation; `Infinity` when dead. */
    coolingUntil: number;
    /** How many plan/quota refusals this key has accumulated. */
    quotaStrikes: number;
    /** The most recent formatted refusal, used by {@link KeyPool.reasons}. */
    lastError: string | undefined;
}
/** Cooldown tuning for one pool. */
export interface KeyPoolOptions {
    /** Cooldown after HTTP 429. Defaults to {@link DEFAULT_RATE_LIMIT_COOLDOWN_MS}. */
    readonly rateLimitCooldownMs?: number | undefined;
    /** First cooldown after a plan/quota refusal. Defaults to {@link DEFAULT_QUOTA_COOLDOWN_MS}. */
    readonly quotaCooldownMs?: number | undefined;
    /** Ceiling for the escalating quota cooldown. Defaults to {@link DEFAULT_QUOTA_COOLDOWN_MAX_MS}. */
    readonly quotaCooldownMaxMs?: number | undefined;
}
/**
 * The rotation tuning both providers accept: their own cooldown knobs plus the
 * per-call attempt budget the rotation loop in each provider enforces.
 */
export interface KeyRotationOptions extends KeyPoolOptions {
    /** How many pool keys one call may try. Defaults to the pool size. */
    readonly maxAttempts?: number | undefined;
}
/**
 * The credential rotation state for one provider instance. Entries are keyed by
 * the credential value itself: duplicates collapse, so the same key pasted into
 * both `apiKey` and `apiKeys` cannot be counted twice.
 */
export declare class KeyPool {
    /** The pool's entries, in configured order. */
    readonly entries: KeyPoolEntry[];
    /** Round-robin cursor: where the next selection starts. */
    cursor: number;
    /** The resolved cooldown after HTTP 429. */
    readonly rateLimitCooldownMs: number;
    /** The resolved first cooldown after a plan/quota refusal. */
    readonly quotaCooldownMs: number;
    /** The resolved ceiling for the escalating quota cooldown. */
    readonly quotaCooldownMaxMs: number;
    /**
     * @param keys - candidate credentials, in priority order.
     * @param options - cooldown tuning.
     */
    constructor(keys: readonly (string | null | undefined)[] | undefined, options?: KeyPoolOptions);
    /**
     * Adopt a newly read credential list, keeping what the pool already knows.
     *
     * The credential plane is live: a key can be added from the plugin's
     * configuration card, replaced, or removed while the process runs. Entries
     * whose key survives keep their cooldown, strike count and rejection state —
     * re-reading must not hand a cooling credential back to rotation — while
     * keys that disappeared are dropped with their state and new keys join
     * clean. Labels are re-derived, since they name a position.
     * @param keys - the freshly resolved credentials, in priority order.
     */
    reconcile(keys: readonly (string | null | undefined)[] | undefined): void;
    /** How many credentials the pool was configured with. */
    get size(): number;
    /**
     * The credentials usable right now.
     * @param now - current epoch milliseconds.
     * @returns the usable entries in configured order.
     */
    ready(now?: number): KeyPoolEntry[];
    /**
     * Take the next credential in round-robin order, skipping the ones under
     * cooldown. Concurrency-safe by construction: the cursor advances before the
     * caller awaits, so parallel searches from one `web_search` call land on
     * different keys.
     * @param now - current epoch milliseconds.
     * @returns the chosen entry, or `undefined` when no key is usable.
     */
    next(now?: number): KeyPoolEntry | undefined;
    /**
     * Record a successful call: the credential is healthy again, so any cooldown
     * and escalation it had accumulated is cleared.
     * @param entry - the entry that served the call.
     */
    reportSuccess(entry: KeyPoolEntry): void;
    /**
     * Record a refusal and take the credential out of rotation.
     * @param entry - the entry that was refused.
     * @param kind - a {@link KEY_FAILURE} value.
     * @param message - a short, already-formatted description of the refusal.
     */
    reportFailure(entry: KeyPoolEntry, kind: KeyFailureKind, message: string): void;
    /**
     * How long until a cooled-down credential is worth trying again.
     * @param now - current epoch milliseconds.
     * @returns milliseconds, `Infinity` when every key is dead.
     */
    retryAfterMs(now?: number): number;
    /**
     * One-line pool state for an error message, e.g. `1/3 keys ready, 1 cooling, 1 rejected`.
     * @param now - current epoch milliseconds.
     * @returns the summary.
     */
    describe(now?: number): string;
    /**
     * Per-key reasons, for the error raised when every attempt failed. Unused
     * keys are skipped, and the list is capped so a large pool cannot flood a
     * tool result.
     * @param limit - maximum entries to describe.
     * @returns e.g. `#1 (tvly-a…1111) HTTP 432: plan limit; #2 rejected`.
     */
    reasons(limit?: number): string;
}
/** The provider's nouns used to build a rotation error message. */
export interface RotationLabels {
    /** Prefix for an attempt that failed, e.g. `Tavily API error`. */
    readonly failure: string;
    /** Subject for a pool with nothing usable, e.g. `Tavily search`. */
    readonly empty: string;
}
/** Optional trailing hint appended to a rotation error message. */
export interface RotationMessageOptions {
    /** Guidance appended to the message, without leading punctuation or whitespace. */
    readonly hint?: string | undefined;
}
/**
 * Build the message for a call whose attempts all failed, or that found no
 * usable credential at all. Providers wrap the returned string in their own
 * `WebError`, so this module stays free of DSH imports.
 *
 * A single-credential pool keeps the shape callers knew before rotation
 * existed, now carrying the API's own explanation instead of a bare status.
 * @param labels - the provider's nouns.
 * @param pool - the pool that served the call.
 * @param failures - this call's attempts, in order.
 * @param options - optional trailing hint, already formatted.
 * @returns the message.
 */
export declare function rotationMessage(labels: RotationLabels, pool: KeyPool, failures: readonly RotationFailure[], options?: RotationMessageOptions): string;
