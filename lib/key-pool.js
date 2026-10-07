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
export const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60000;
/** First cooldown applied after a plan/quota refusal (HTTP 402/403/432/433). */
export const DEFAULT_QUOTA_COOLDOWN_MS = 1800000;
/** Ceiling the escalating quota cooldown stops at. */
export const DEFAULT_QUOTA_COOLDOWN_MAX_MS = 86400000;
/** Failure classes a pool understands. */
export const KEY_FAILURE = {
    /** The credential itself was rejected (HTTP 401): dead for this process. */
    INVALID: 'invalid',
    /** Short-term throttle (HTTP 429): fixed short cooldown. */
    RATE: 'rate',
    /** Plan usage limit (HTTP 402/403/432/433): escalating cooldown. */
    QUOTA: 'quota',
};
/** A retryable but key-neutral failure (HTTP 5xx): rotate without blaming the key. */
export const TRANSIENT_FAILURE = 'transient';
/**
 * One key-scoped attempt failure: the API answered, and the answer blames the
 * credential (or is transient) rather than the request. Providers throw this
 * from a single attempt; the rotation loop decides whether to continue on
 * another key.
 */
export class AttemptFailure extends Error {
    /** The HTTP status the provider API answered with. */
    status;
    /** A {@link KEY_FAILURE} value, {@link TRANSIENT_FAILURE}, or `undefined` for a request-level error that no other key can fix. */
    kind;
    /** Whether another key may succeed where this one failed. */
    retryable;
    /**
     * @param status - the HTTP status the provider API answered with.
     * @param kind - a {@link KEY_FAILURE} value, {@link TRANSIENT_FAILURE}, or `undefined` for a request-level error that no other key can fix.
     * @param message - the API's own explanation, already truncated.
     */
    constructor(status, kind, message) {
        super(message);
        this.name = 'AttemptFailure';
        this.status = status;
        this.kind = kind;
        this.retryable = kind !== undefined;
    }
}
/**
 * The credential list a provider instance should rotate over. A live
 * {@link KeySource} owns the list when one is configured; otherwise `apiKeys`
 * wins over the legacy single `apiKey` and blanks are dropped by the pool.
 * @param options - provider options.
 * @returns the candidates.
 */
export function collectKeys(options) {
    const source = options?.keySource;
    if (source !== undefined)
        return source.current();
    const listed = options?.apiKeys;
    if (Array.isArray(listed) && listed.length > 0)
        return listed;
    const single = options?.apiKey;
    return single === undefined ? [] : [single];
}
/**
 * Classify one provider-API HTTP status for key rotation.
 * @param status - the HTTP status the provider API answered with.
 * @returns a {@link KEY_FAILURE} value or {@link TRANSIENT_FAILURE} to retry on the next key; `undefined` when the status is not a credential or availability problem at all (a malformed request), which must surface as-is.
 */
export function classifyHttpStatus(status) {
    if (status === 401)
        return KEY_FAILURE.INVALID;
    if (status === 429)
        return KEY_FAILURE.RATE;
    if (status === 402 || status === 403 || status === 432 || status === 433)
        return KEY_FAILURE.QUOTA;
    if (status >= 500)
        return TRANSIENT_FAILURE;
    return undefined;
}
/**
 * Split one environment value into a key list. Multi-key values are written
 * with any mix of commas, semicolons, and whitespace (including newlines), so
 * `TAVILY_API_KEYS=tvly-a,tvly-b` and a multi-line value both work.
 * @param value - the raw environment value.
 * @returns the non-empty, trimmed keys in first-seen order.
 */
export function parseKeyList(value) {
    if (typeof value !== 'string')
        return [];
    return value
        .split(/[\s,;]+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}
/** Shortest credential whose masked tail still hides at least as much as it shows. */
export const MASK_MIN_KEY_LENGTH = 20;
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
export function maskKey(key, index) {
    const label = `#${index + 1}`;
    if (key.length <= MASK_MIN_KEY_LENGTH)
        return label;
    return `${label} (${key.slice(0, 6)}…${key.slice(-4)})`;
}
/**
 * Normalize one provider endpoint base: a configured trailing slash would
 * otherwise concatenate into `//search` / `//v1/scrape` and turn a working
 * endpoint into a 404. Only trailing slashes are removed, so the value is
 * still the operator's own (including an unusable one, which `available()`
 * keeps rejecting).
 * @param baseURL - the configured endpoint base.
 * @returns the base without trailing slashes.
 */
export function trimBaseURL(baseURL) {
    return baseURL.replace(/\/+$/, '');
}
/**
 * Render a cooldown for a human reading a tool error.
 * @param ms - milliseconds; `Infinity` means "never".
 * @returns e.g. `42s`, `5m`, `2.5h`, `1.2d`, `never`.
 */
export function formatWait(ms) {
    if (!Number.isFinite(ms))
        return 'never';
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 60)
        return `${seconds}s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60)
        return `${minutes}m`;
    const hours = ms / 3600000;
    if (hours < 48)
        return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`;
    return `${(ms / 86400000).toFixed(1)}d`;
}
/** Fall back to a default unless the value is a usable positive integer. */
function positive(value, fallback) {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}
/**
 * Trim, drop blanks and collapse duplicates: one canonical credential list in
 * first-seen order, so the same key pasted in both `apiKey` and `apiKeys`
 * cannot be counted twice.
 * @param keys - candidate credentials, possibly messy.
 * @returns the canonical list.
 */
function normalizeKeys(keys) {
    const seen = new Set();
    const normalized = [];
    for (const raw of keys ?? []) {
        const key = typeof raw === 'string' ? raw.trim() : '';
        if (key.length === 0 || seen.has(key))
            continue;
        seen.add(key);
        normalized.push(key);
    }
    return normalized;
}
/** Build one pool entry for a credential at a known position. */
function newEntry(key, index) {
    return {
        key,
        label: maskKey(key, index),
        dead: false,
        coolingUntil: 0,
        quotaStrikes: 0,
        lastError: undefined,
    };
}
/**
 * The credential rotation state for one provider instance. Entries are keyed by
 * the credential value itself: duplicates collapse, so the same key pasted into
 * both `apiKey` and `apiKeys` cannot be counted twice.
 */
export class KeyPool {
    /** The pool's entries, in configured order. */
    entries = [];
    /** Round-robin cursor: where the next selection starts. */
    cursor = 0;
    /** The resolved cooldown after HTTP 429. */
    rateLimitCooldownMs;
    /** The resolved first cooldown after a plan/quota refusal. */
    quotaCooldownMs;
    /** The resolved ceiling for the escalating quota cooldown. */
    quotaCooldownMaxMs;
    /**
     * @param keys - candidate credentials, in priority order.
     * @param options - cooldown tuning.
     */
    constructor(keys, options = {}) {
        for (const [index, key] of normalizeKeys(keys).entries())
            this.entries.push(newEntry(key, index));
        this.rateLimitCooldownMs = positive(options.rateLimitCooldownMs, DEFAULT_RATE_LIMIT_COOLDOWN_MS);
        this.quotaCooldownMs = positive(options.quotaCooldownMs, DEFAULT_QUOTA_COOLDOWN_MS);
        this.quotaCooldownMaxMs = positive(options.quotaCooldownMaxMs, DEFAULT_QUOTA_COOLDOWN_MAX_MS);
    }
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
    reconcile(keys) {
        const previous = new Map(this.entries.map((entry) => [entry.key, entry]));
        const wanted = normalizeKeys(keys);
        this.entries.length = 0;
        for (const [index, key] of wanted.entries()) {
            const existing = previous.get(key);
            if (existing === undefined) {
                this.entries.push(newEntry(key, index));
                continue;
            }
            existing.label = maskKey(key, index);
            this.entries.push(existing);
        }
        this.cursor = this.entries.length === 0 ? 0 : this.cursor % this.entries.length;
    }
    /** How many credentials the pool was configured with. */
    get size() {
        return this.entries.length;
    }
    /**
     * The credentials usable right now.
     * @param now - current epoch milliseconds.
     * @returns the usable entries in configured order.
     */
    ready(now = Date.now()) {
        return this.entries.filter((entry) => !entry.dead && now >= entry.coolingUntil);
    }
    /**
     * Take the next credential in round-robin order, skipping the ones under
     * cooldown. Concurrency-safe by construction: the cursor advances before the
     * caller awaits, so parallel searches from one `web_search` call land on
     * different keys.
     * @param now - current epoch milliseconds.
     * @returns the chosen entry, or `undefined` when no key is usable.
     */
    next(now = Date.now()) {
        const total = this.entries.length;
        for (let step = 0; step < total; step += 1) {
            const index = (this.cursor + step) % total;
            const entry = this.entries[index];
            if (entry === undefined || entry.dead || now < entry.coolingUntil)
                continue;
            this.cursor = (index + 1) % total;
            return entry;
        }
        return undefined;
    }
    /**
     * Record a successful call: the credential is healthy again, so any cooldown
     * and escalation it had accumulated is cleared.
     * @param entry - the entry that served the call.
     */
    reportSuccess(entry) {
        entry.coolingUntil = 0;
        entry.quotaStrikes = 0;
        entry.lastError = undefined;
    }
    /**
     * Record a refusal and take the credential out of rotation.
     * @param entry - the entry that was refused.
     * @param kind - a {@link KEY_FAILURE} value.
     * @param message - a short, already-formatted description of the refusal.
     */
    reportFailure(entry, kind, message) {
        entry.lastError = message;
        if (kind === KEY_FAILURE.INVALID) {
            entry.dead = true;
            entry.coolingUntil = Number.POSITIVE_INFINITY;
            return;
        }
        if (kind === KEY_FAILURE.RATE) {
            entry.coolingUntil = Date.now() + this.rateLimitCooldownMs;
            return;
        }
        entry.quotaStrikes += 1;
        const wait = Math.min(this.quotaCooldownMs * 2 ** (entry.quotaStrikes - 1), this.quotaCooldownMaxMs);
        entry.coolingUntil = Date.now() + wait;
    }
    /**
     * How long until a cooled-down credential is worth trying again.
     * @param now - current epoch milliseconds.
     * @returns milliseconds, `Infinity` when every key is dead.
     */
    retryAfterMs(now = Date.now()) {
        let wait = Number.POSITIVE_INFINITY;
        for (const entry of this.entries) {
            if (entry.dead)
                continue;
            wait = Math.min(wait, Math.max(0, entry.coolingUntil - now));
        }
        return wait;
    }
    /**
     * One-line pool state for an error message, e.g. `1/3 keys ready, 1 cooling, 1 rejected`.
     * @param now - current epoch milliseconds.
     * @returns the summary.
     */
    describe(now = Date.now()) {
        const ready = this.ready(now).length;
        const dead = this.entries.filter((entry) => entry.dead).length;
        const cooling = this.size - ready - dead;
        const parts = [`${ready}/${this.size} ${this.size === 1 ? 'key' : 'keys'} ready`];
        if (cooling > 0)
            parts.push(`${cooling} cooling`);
        if (dead > 0)
            parts.push(`${dead} rejected`);
        return parts.join(', ');
    }
    /**
     * Per-key reasons, for the error raised when every attempt failed. Unused
     * keys are skipped, and the list is capped so a large pool cannot flood a
     * tool result.
     * @param limit - maximum entries to describe.
     * @returns e.g. `#1 (tvly-a…1111) HTTP 432: plan limit; #2 rejected`.
     */
    reasons(limit = 3) {
        const struck = this.entries.filter((entry) => entry.dead || entry.coolingUntil > 0);
        const described = struck
            .slice(0, limit)
            .map((entry) => `${entry.label} ${entry.dead ? 'rejected (invalid key)' : entry.lastError ?? 'cooling'}`);
        const hidden = struck.length - described.length;
        if (hidden > 0)
            described.push(`+${hidden} more`);
        return described.join('; ');
    }
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
export function rotationMessage(labels, pool, failures, options = {}) {
    const state = pool.describe();
    const hint = options.hint ?? '';
    if (failures.length === 0) {
        const reasons = pool.reasons();
        const wait = formatWait(pool.retryAfterMs());
        return joinHint(`${labels.empty} has no usable API key (${state}); next key available in ${wait}`
            + `${reasons.length > 0 ? `. ${reasons}` : ''}`, hint);
    }
    // The empty case returned above, so this call has at least one attempt.
    const last = failures[failures.length - 1];
    // Credential bookkeeping is only meaningful when the API blamed a key. A
    // request-level refusal (HTTP 400 and friends) is the same answer whichever
    // key sent it, so naming keys there would only add noise.
    const credentialScoped = last.error.kind !== undefined;
    const multi = pool.size > 1;
    const keyNote = multi && credentialScoped ? ` on ${last.entry.label}` : '';
    const tried = multi && credentialScoped && failures.length > 1 ? ` (tried ${failures.length} keys)` : '';
    const wait = pool.retryAfterMs();
    const poolNote = multi && credentialScoped
        ? pool.ready().length === 0 && Number.isFinite(wait) ? ` [${state}, next key in ${formatWait(wait)}]` : ` [${state}]`
        : '';
    return joinHint(`${labels.failure} (HTTP ${last.error.status})${keyNote}: ${last.error.message}${tried}${poolNote}`, hint);
}
/**
 * Append a guidance hint as its own sentence. Provider messages arrive with
 * whatever punctuation the API used, so the separator is chosen instead of
 * assumed.
 * @param text - the message so far.
 * @param hint - the hint, without leading punctuation or whitespace.
 * @returns the joined message.
 */
function joinHint(text, hint) {
    if (hint.length === 0)
        return text;
    const separator = /[.!?…:;]$/.test(text.trimEnd()) ? ' ' : '. ';
    return `${text}${separator}${hint.trim()}`;
}
