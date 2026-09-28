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
export const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60000

/** First cooldown applied after a plan/quota refusal (HTTP 402/403/432/433). */
export const DEFAULT_QUOTA_COOLDOWN_MS = 1800000

/** Ceiling the escalating quota cooldown stops at. */
export const DEFAULT_QUOTA_COOLDOWN_MAX_MS = 86400000

/** Failure classes a pool understands. */
export const KEY_FAILURE = {
  /** The credential itself was rejected (HTTP 401): dead for this process. */
  INVALID: 'invalid',
  /** Short-term throttle (HTTP 429): fixed short cooldown. */
  RATE: 'rate',
  /** Plan usage limit (HTTP 402/403/432/433): escalating cooldown. */
  QUOTA: 'quota',
} as const

/** A {@link KEY_FAILURE} value. */
export type KeyFailureKind = (typeof KEY_FAILURE)[keyof typeof KEY_FAILURE]

/** A retryable but key-neutral failure (HTTP 5xx): rotate without blaming the key. */
export const TRANSIENT_FAILURE = 'transient'

/** A {@link KEY_FAILURE} value or {@link TRANSIENT_FAILURE}. */
export type AttemptKind = KeyFailureKind | typeof TRANSIENT_FAILURE

/**
 * One key-scoped attempt failure: the API answered, and the answer blames the
 * credential (or is transient) rather than the request. Providers throw this
 * from a single attempt; the rotation loop decides whether to continue on
 * another key.
 */
export class AttemptFailure extends Error {
  /** The HTTP status the provider API answered with. */
  readonly status: number

  /** A {@link KEY_FAILURE} value, {@link TRANSIENT_FAILURE}, or `undefined` for a request-level error that no other key can fix. */
  readonly kind: AttemptKind | undefined

  /** Whether another key may succeed where this one failed. */
  readonly retryable: boolean

  /**
   * @param status - the HTTP status the provider API answered with.
   * @param kind - a {@link KEY_FAILURE} value, {@link TRANSIENT_FAILURE}, or `undefined` for a request-level error that no other key can fix.
   * @param message - the API's own explanation, already truncated.
   */
  constructor(status: number, kind: AttemptKind | undefined, message: string) {
    super(message)
    this.name = 'AttemptFailure'
    this.status = status
    this.kind = kind
    this.retryable = kind !== undefined
  }
}

/**
 * What {@link rotationMessage} needs from one attempt failure. `AttemptFailure`
 * satisfies it; tests and callers may hand over any error carrying the same
 * three readings, as the pre-rotation code did.
 */
export interface AttemptFailureLike {
  /** The HTTP status the provider API answered with. */
  readonly status: number
  /** A {@link KEY_FAILURE} value, {@link TRANSIENT_FAILURE}, or `undefined`. */
  readonly kind: string | undefined
  /** The API's own explanation. */
  readonly message: string
}

/** One attempt of one call, paired with the credential that made it. */
export interface RotationFailure {
  /** The pool entry the attempt used. */
  readonly entry: KeyPoolEntry
  /** Why the attempt failed. */
  readonly error: AttemptFailureLike
}

/** The credential material a provider instance is built from. */
export interface CredentialOptions {
  /** One credential (legacy single-key form). */
  readonly apiKey?: string | undefined
  /** The credential pool; wins over `apiKey`. */
  readonly apiKeys?: readonly string[] | undefined
}

/**
 * The credential list a provider instance should rotate over. `apiKeys` wins
 * over the legacy single `apiKey`; blanks are dropped by the pool itself.
 * @param options - provider options.
 * @returns the candidates.
 */
export function collectKeys(options?: CredentialOptions | undefined): readonly string[] {
  const listed = options?.apiKeys
  if (Array.isArray(listed) && listed.length > 0) return listed
  const single = options?.apiKey
  return single === undefined ? [] : [single]
}

/**
 * Classify one provider-API HTTP status for key rotation.
 * @param status - the HTTP status the provider API answered with.
 * @returns a {@link KEY_FAILURE} value or {@link TRANSIENT_FAILURE} to retry on the next key; `undefined` when the status is not a credential or availability problem at all (a malformed request), which must surface as-is.
 */
export function classifyHttpStatus(status: number): AttemptKind | undefined {
  if (status === 401) return KEY_FAILURE.INVALID
  if (status === 429) return KEY_FAILURE.RATE
  if (status === 402 || status === 403 || status === 432 || status === 433) return KEY_FAILURE.QUOTA
  if (status >= 500) return TRANSIENT_FAILURE
  return undefined
}

/**
 * Split one environment value into a key list. Multi-key values are written
 * with any mix of commas, semicolons, and whitespace (including newlines), so
 * `TAVILY_API_KEYS=tvly-a,tvly-b` and a multi-line value both work.
 * @param value - the raw environment value.
 * @returns the non-empty, trimmed keys in first-seen order.
 */
export function parseKeyList(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return value
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/**
 * Build the display label for one credential: its 1-based position plus a
 * masked tail. Error messages and diagnostics name keys this way, so a
 * multi-account setup can be told apart without printing a usable secret.
 * @param key - the credential.
 * @param index - its zero-based position in the pool.
 * @returns e.g. `#2 (tvly-d…cdef)`, or plain `#2` for short values.
 */
export function maskKey(key: string, index: number): string {
  const label = `#${index + 1}`
  if (key.length <= 10) return label
  return `${label} (${key.slice(0, 6)}…${key.slice(-4)})`
}

/**
 * Render a cooldown for a human reading a tool error.
 * @param ms - milliseconds; `Infinity` means "never".
 * @returns e.g. `42s`, `5m`, `2.5h`, `1.2d`, `never`.
 */
export function formatWait(ms: number): string {
  if (!Number.isFinite(ms)) return 'never'
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = ms / 3600000
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`
  return `${(ms / 86400000).toFixed(1)}d`
}

/** Fall back to a default unless the value is a usable positive integer. */
function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback
}

/** One credential plus the bookkeeping the pool keeps about it. */
export interface KeyPoolEntry {
  /** The credential itself. */
  readonly key: string
  /** The masked display label used in error messages. */
  readonly label: string
  /** True once the API rejected the credential itself (HTTP 401). */
  dead: boolean
  /** Epoch milliseconds until which the key is out of rotation; `Infinity` when dead. */
  coolingUntil: number
  /** How many plan/quota refusals this key has accumulated. */
  quotaStrikes: number
  /** The most recent formatted refusal, used by {@link KeyPool.reasons}. */
  lastError: string | undefined
}

/** Cooldown tuning for one pool. */
export interface KeyPoolOptions {
  /** Cooldown after HTTP 429. Defaults to {@link DEFAULT_RATE_LIMIT_COOLDOWN_MS}. */
  readonly rateLimitCooldownMs?: number | undefined
  /** First cooldown after a plan/quota refusal. Defaults to {@link DEFAULT_QUOTA_COOLDOWN_MS}. */
  readonly quotaCooldownMs?: number | undefined
  /** Ceiling for the escalating quota cooldown. Defaults to {@link DEFAULT_QUOTA_COOLDOWN_MAX_MS}. */
  readonly quotaCooldownMaxMs?: number | undefined
}

/**
 * The rotation tuning both providers accept: their own cooldown knobs plus the
 * per-call attempt budget the rotation loop in each provider enforces.
 */
export interface KeyRotationOptions extends KeyPoolOptions {
  /** How many pool keys one call may try. Defaults to the pool size. */
  readonly maxAttempts?: number | undefined
}

/**
 * The credential rotation state for one provider instance. Entries are keyed by
 * the credential value itself: duplicates collapse, so the same key pasted into
 * both `apiKey` and `apiKeys` cannot be counted twice.
 */
export class KeyPool {
  /** The pool's entries, in configured order. */
  readonly entries: KeyPoolEntry[] = []

  /** Round-robin cursor: where the next selection starts. */
  cursor = 0

  /** The resolved cooldown after HTTP 429. */
  readonly rateLimitCooldownMs: number

  /** The resolved first cooldown after a plan/quota refusal. */
  readonly quotaCooldownMs: number

  /** The resolved ceiling for the escalating quota cooldown. */
  readonly quotaCooldownMaxMs: number

  /**
   * @param keys - candidate credentials, in priority order.
   * @param options - cooldown tuning.
   */
  constructor(keys: readonly (string | null | undefined)[] | undefined, options: KeyPoolOptions = {}) {
    const seen = new Set<string>()
    for (const raw of keys ?? []) {
      const key = typeof raw === 'string' ? raw.trim() : ''
      if (key.length === 0 || seen.has(key)) continue
      seen.add(key)
      this.entries.push({
        key,
        label: maskKey(key, this.entries.length),
        dead: false,
        coolingUntil: 0,
        quotaStrikes: 0,
        lastError: undefined,
      })
    }
    this.rateLimitCooldownMs = positive(options.rateLimitCooldownMs, DEFAULT_RATE_LIMIT_COOLDOWN_MS)
    this.quotaCooldownMs = positive(options.quotaCooldownMs, DEFAULT_QUOTA_COOLDOWN_MS)
    this.quotaCooldownMaxMs = positive(options.quotaCooldownMaxMs, DEFAULT_QUOTA_COOLDOWN_MAX_MS)
  }

  /** How many credentials the pool was configured with. */
  get size(): number {
    return this.entries.length
  }

  /**
   * The credentials usable right now.
   * @param now - current epoch milliseconds.
   * @returns the usable entries in configured order.
   */
  ready(now: number = Date.now()): KeyPoolEntry[] {
    return this.entries.filter((entry) => !entry.dead && now >= entry.coolingUntil)
  }

  /**
   * Take the next credential in round-robin order, skipping the ones under
   * cooldown. Concurrency-safe by construction: the cursor advances before the
   * caller awaits, so parallel searches from one `web_search` call land on
   * different keys.
   * @param now - current epoch milliseconds.
   * @returns the chosen entry, or `undefined` when no key is usable.
   */
  next(now: number = Date.now()): KeyPoolEntry | undefined {
    const total = this.entries.length
    for (let step = 0; step < total; step += 1) {
      const index = (this.cursor + step) % total
      const entry = this.entries[index]
      if (entry === undefined || entry.dead || now < entry.coolingUntil) continue
      this.cursor = (index + 1) % total
      return entry
    }
    return undefined
  }

  /**
   * Record a successful call: the credential is healthy again, so any cooldown
   * and escalation it had accumulated is cleared.
   * @param entry - the entry that served the call.
   */
  reportSuccess(entry: KeyPoolEntry): void {
    entry.coolingUntil = 0
    entry.quotaStrikes = 0
    entry.lastError = undefined
  }

  /**
   * Record a refusal and take the credential out of rotation.
   * @param entry - the entry that was refused.
   * @param kind - a {@link KEY_FAILURE} value.
   * @param message - a short, already-formatted description of the refusal.
   */
  reportFailure(entry: KeyPoolEntry, kind: KeyFailureKind, message: string): void {
    entry.lastError = message
    if (kind === KEY_FAILURE.INVALID) {
      entry.dead = true
      entry.coolingUntil = Number.POSITIVE_INFINITY
      return
    }
    if (kind === KEY_FAILURE.RATE) {
      entry.coolingUntil = Date.now() + this.rateLimitCooldownMs
      return
    }
    entry.quotaStrikes += 1
    const wait = Math.min(this.quotaCooldownMs * 2 ** (entry.quotaStrikes - 1), this.quotaCooldownMaxMs)
    entry.coolingUntil = Date.now() + wait
  }

  /**
   * How long until a cooled-down credential is worth trying again.
   * @param now - current epoch milliseconds.
   * @returns milliseconds, `Infinity` when every key is dead.
   */
  retryAfterMs(now: number = Date.now()): number {
    let wait = Number.POSITIVE_INFINITY
    for (const entry of this.entries) {
      if (entry.dead) continue
      wait = Math.min(wait, Math.max(0, entry.coolingUntil - now))
    }
    return wait
  }

  /**
   * One-line pool state for an error message, e.g. `1/3 keys ready, 1 cooling, 1 rejected`.
   * @param now - current epoch milliseconds.
   * @returns the summary.
   */
  describe(now: number = Date.now()): string {
    const ready = this.ready(now).length
    const dead = this.entries.filter((entry) => entry.dead).length
    const cooling = this.size - ready - dead
    const parts = [`${ready}/${this.size} ${this.size === 1 ? 'key' : 'keys'} ready`]
    if (cooling > 0) parts.push(`${cooling} cooling`)
    if (dead > 0) parts.push(`${dead} rejected`)
    return parts.join(', ')
  }

  /**
   * Per-key reasons, for the error raised when every attempt failed. Unused
   * keys are skipped, and the list is capped so a large pool cannot flood a
   * tool result.
   * @param limit - maximum entries to describe.
   * @returns e.g. `#1 (tvly-a…1111) HTTP 432: plan limit; #2 rejected`.
   */
  reasons(limit = 3): string {
    const struck = this.entries.filter((entry) => entry.dead || entry.coolingUntil > 0)
    const described = struck
      .slice(0, limit)
      .map((entry) => `${entry.label} ${entry.dead ? 'rejected (invalid key)' : entry.lastError ?? 'cooling'}`)
    const hidden = struck.length - described.length
    if (hidden > 0) described.push(`+${hidden} more`)
    return described.join('; ')
  }
}

/** The provider's nouns used to build a rotation error message. */
export interface RotationLabels {
  /** Prefix for an attempt that failed, e.g. `Tavily API error`. */
  readonly failure: string
  /** Subject for a pool with nothing usable, e.g. `Tavily search`. */
  readonly empty: string
}

/** Optional trailing hint appended to a rotation error message. */
export interface RotationMessageOptions {
  /** Guidance appended to the message, without leading punctuation or whitespace. */
  readonly hint?: string | undefined
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
export function rotationMessage(
  labels: RotationLabels,
  pool: KeyPool,
  failures: readonly RotationFailure[],
  options: RotationMessageOptions = {},
): string {
  const state = pool.describe()
  const hint = options.hint ?? ''
  if (failures.length === 0) {
    const reasons = pool.reasons()
    const wait = formatWait(pool.retryAfterMs())
    return joinHint(`${labels.empty} has no usable API key (${state}); next key available in ${wait}`
      + `${reasons.length > 0 ? `. ${reasons}` : ''}`, hint)
  }
  // The empty case returned above, so this call has at least one attempt.
  const last = failures[failures.length - 1]!
  // Credential bookkeeping is only meaningful when the API blamed a key. A
  // request-level refusal (HTTP 400 and friends) is the same answer whichever
  // key sent it, so naming keys there would only add noise.
  const credentialScoped = last.error.kind !== undefined
  const multi = pool.size > 1
  const keyNote = multi && credentialScoped ? ` on ${last.entry.label}` : ''
  const tried = multi && credentialScoped && failures.length > 1 ? ` (tried ${failures.length} keys)` : ''
  const wait = pool.retryAfterMs()
  const poolNote = multi && credentialScoped
    ? pool.ready().length === 0 && Number.isFinite(wait) ? ` [${state}, next key in ${formatWait(wait)}]` : ` [${state}]`
    : ''
  return joinHint(`${labels.failure} (HTTP ${last.error.status})${keyNote}: ${last.error.message}${tried}${poolNote}`, hint)
}

/**
 * Append a guidance hint as its own sentence. Provider messages arrive with
 * whatever punctuation the API used, so the separator is chosen instead of
 * assumed.
 * @param text - the message so far.
 * @param hint - the hint, without leading punctuation or whitespace.
 * @returns the joined message.
 */
function joinHint(text: string, hint: string): string {
  if (hint.length === 0) return text
  const separator = /[.!?…:;]$/.test(text.trimEnd()) ? ' ' : '. '
  return `${text}${separator}${hint.trim()}`
}
