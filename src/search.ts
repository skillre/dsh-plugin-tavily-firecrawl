/**
 * `TavilySearchProvider`: a `WebSearchProvider` backed by the Tavily search
 * API (`POST /search`). Maps Tavily's `results[]` into the seam's normalized
 * `WebSearchSource` list and its synthesized answer into `content`.
 *
 * Credentials are a rotating pool: several Tavily accounts can be listed, and a
 * request that a key refuses (quota, rate limit, invalid credential) continues
 * on the next usable key instead of failing the whole tool call.
 * @module @skillre/dsh-plugin-tavily-firecrawl/search
 */

import { readFileSync } from 'node:fs'
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import {
  AttemptFailure,
  KEY_FAILURE,
  KeyPool,
  TRANSIENT_FAILURE,
  classifyHttpStatus,
  collectKeys,
  rotationMessage,
  trimBaseURL,
} from './key-pool.js'
import type { CredentialOptions, KeyPoolEntry, KeyRotationOptions, RotationFailure } from './key-pool.js'

/** Stable id this provider registers under. */
export const TAVILY_PROVIDER_ID = 'tavily'

/** Default Tavily search endpoint; `/search` is the operation. */
export const TAVILY_DEFAULT_BASE_URL = 'https://api.tavily.com'

/** Default retrieval depth: basic (fast, 1 credit) or advanced (2 credits). */
export const TAVILY_DEFAULT_SEARCH_DEPTH = 'basic'

/** Default: ask Tavily for a synthesized answer alongside the sources. */
export const TAVILY_DEFAULT_INCLUDE_ANSWER = true

/** Default per-attempt request timeout in milliseconds. */
export const TAVILY_DEFAULT_TIMEOUT_MS = 30000

/** Snippet cap: Tavily's `content` field can run to thousands of characters. */
export const TAVILY_MAX_SNIPPET_CHARS = 600

/** Cap on a provider error message copied into a `WebError`. */
const MAX_ERROR_CHARS = 240

/** Tavily's retrieval depth control, sent as `search_depth`. */
export type TavilySearchDepth = 'basic' | 'advanced'

/** Construction options for {@link TavilySearchProvider}. */
export interface TavilySearchProviderOptions extends CredentialOptions, KeyRotationOptions {
  /** Endpoint base; `/search` is appended. */
  readonly baseURL: string
  /** Retrieval depth sent as Tavily's `search_depth`. `basic` costs 1 credit, `advanced` 2. */
  readonly searchDepth?: TavilySearchDepth | undefined
  /** Ask Tavily for a synthesized answer (becomes the result `content`). */
  readonly includeAnswer?: boolean | undefined
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  readonly maxResults?: number | undefined
  /** Per-attempt request timeout in milliseconds. */
  readonly timeoutMs?: number | undefined
}

/**
 * This package's own version, read from the manifest that ships beside the
 * built file. The attribution header must never drift from the released
 * package, and both layouts (`src/` under vitest, `lib/` once built) keep
 * `package.json` one directory above the module.
 * @returns the manifest version, or `0.0.0` when it cannot be read.
 */
function packageVersion(): string {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown }
    return typeof manifest.version === 'string' && manifest.version.length > 0 ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** Attribution header sent on every request; the version follows the package. */
const USER_AGENT = `skillre-tavily-firecrawl/${packageVersion()} (tavily)`

/**
 * The Tavily-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`.
 * `available()` is a cheap local check (at least one credential + config shape)
 * and never touches the network, per the seam's selection contract. It
 * deliberately ignores cooldowns: a pool whose keys are all cooling is still
 * "available", so the call can explain which keys are cooling instead of
 * degrading into a bare `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`.
 */
export class TavilySearchProvider implements WebSearchProvider {
  /** Stable registry id: `tavily`. */
  readonly id = TAVILY_PROVIDER_ID

  /** The options this instance was built with. */
  readonly options: TavilySearchProviderOptions

  /** The credential rotation state. */
  readonly pool: KeyPool

  /**
   * @param options - provider options.
   */
  constructor(options: TavilySearchProviderOptions) {
    this.options = { ...options, baseURL: trimBaseURL(options.baseURL) }
    this.pool = new KeyPool(collectKeys(this.options), {
      rateLimitCooldownMs: options.rateLimitCooldownMs,
      quotaCooldownMs: options.quotaCooldownMs,
      quotaCooldownMaxMs: options.quotaCooldownMaxMs,
    })
  }

  /** A cheap local usability check: at least one credential and a usable config shape. */
  available(): boolean {
    const { maxResults } = this.options
    return this.pool.size > 0
      && URL.canParse(this.options.baseURL)
      && (maxResults === undefined || (Number.isInteger(maxResults) && maxResults > 0))
  }

  /**
   * Run one search, rotating to the next key when the API blames the
   * credential, until the attempt budget is spent.
   * @param request - the seam request.
   * @param signal - caller cancellation.
   * @returns the normalized search result.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const maxResults = request.maxResults ?? this.options.maxResults
    const attempts = Math.max(1, Math.min(this.options.maxAttempts ?? this.pool.size, this.pool.size))
    const failures: { entry: KeyPoolEntry, error: AttemptFailure }[] = []
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const entry = this.pool.next()
      if (entry === undefined) break
      try {
        const result = await this.searchWith(entry, request, maxResults, signal)
        this.pool.reportSuccess(entry)
        return result
      } catch (error) {
        if (!(error instanceof AttemptFailure)) throw error
        if (error.kind !== undefined && error.kind !== TRANSIENT_FAILURE) {
          this.pool.reportFailure(entry, error.kind, `HTTP ${error.status}: ${error.message}`)
        }
        failures.push({ entry, error })
        if (!error.retryable) break
      }
    }
    throw this.failureError(failures)
  }

  /**
   * Run one search attempt with one credential.
   * @param entry - the pool entry to authenticate with.
   * @param request - the seam request.
   * @param maxResults - the resolved result cap.
   * @param signal - caller cancellation.
   * @returns the normalized search result.
   */
  async searchWith(
    entry: KeyPoolEntry,
    request: WebSearchRequest,
    maxResults: number | undefined,
    signal: AbortSignal | undefined,
  ): Promise<WebSearchResult> {
    const configuredTimeout = this.options.timeoutMs
    const timeoutMs = typeof configuredTimeout === 'number' && Number.isInteger(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : TAVILY_DEFAULT_TIMEOUT_MS
    const attemptSignal = signal === undefined
      ? AbortSignal.timeout(timeoutMs)
      : AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    let response: Response
    try {
      response = await fetch(`${this.options.baseURL}/search`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${entry.key}`,
          'content-type': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({
          api_key: entry.key,
          query: request.query,
          search_depth: this.options.searchDepth,
          include_answer: this.options.includeAnswer,
          ...(maxResults !== undefined ? { max_results: maxResults } : {}),
        }),
        signal: attemptSignal,
      })
    } catch (error) {
      if (signal !== undefined && signal.aborted) throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
      if (isAbortError(error)) throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
      if (isTimeoutError(error)) throw new WebError(`Tavily search timed out after ${timeoutMs} ms`, 'WEB_PROVIDER_ERROR', { cause: error })
      throw new WebError(`Tavily search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const message = await readErrorMessage(response)
      throw new AttemptFailure(response.status, classifyHttpStatus(response.status), message)
    }

    try {
      const payload: unknown = await response.json()
      return mapTavilyResponse(payload)
    } catch (error) {
      if (isAbortError(error)) throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Tavily returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  /**
   * Build the error for a call whose attempts all failed, or that found no
   * usable credential at all. A single-credential pool keeps the shape it had
   * before rotation existed, now carrying the API's own explanation.
   * @param failures - attempts made by this call, in order.
   * @returns the error to throw.
   */
  failureError(failures: readonly RotationFailure[]): WebError {
    const quota = failures.some((failure) => failure.error.kind === KEY_FAILURE.QUOTA)
      || this.pool.entries.some((entry) => entry.quotaStrikes > 0)
    const hint = this.pool.size === 1 && quota
      ? 'Add more credentials with `search.apiKeys` or `TAVILY_API_KEYS` to rotate accounts.'
      : ''
    return new WebError(
      rotationMessage({ failure: 'Tavily API error', empty: 'Tavily search' }, this.pool, failures, { hint }),
      'WEB_PROVIDER_ERROR',
    )
  }
}

/** Read an unknown JSON value as a string-keyed record; non-objects read as empty. */
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/**
 * Extract the human-readable reason from a Tavily error payload. Tavily nests
 * it under `detail.error` (`{"detail":{"error":"…"}}`) on its documented error
 * responses, but older and edge responses put a string in `detail`, an `error`,
 * or a `message`; all four shapes are accepted so the reason survives instead of
 * collapsing into a bare HTTP status.
 * @param payload - the parsed response body.
 * @returns the message, or `undefined` when the body carries none.
 */
export function tavilyErrorMessage(payload: unknown): string | undefined {
  const envelope = record(payload)
  const detail = envelope.detail
  const nested = record(detail)
  const candidates: unknown[] = [
    envelope.error,
    typeof detail === 'string' ? detail : nested.error,
    nested.message,
    envelope.message,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim()
  }
  return undefined
}

/**
 * Read the failure reason from an unsuccessful response.
 * @param response - the failing response.
 * @returns the API's message, or a status-based fallback.
 */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const message = tavilyErrorMessage(await response.json())
    if (message !== undefined) return truncate(message, MAX_ERROR_CHARS)
  } catch {
    // The HTTP status still carries the failure; a malformed body only costs a
    // richer message, never the real error.
  }
  return `${response.statusText.length > 0 ? response.statusText : 'request failed'} (no error detail in the response body)`
}

/**
 * Map a Tavily response envelope to a normalized search result: `answer` →
 * `content`, each `results[]` entry → one source (entries without a URL are
 * dropped; `content` becomes the truncated snippet; `published_date` →
 * `publishedAt`).
 * @param payload - the parsed response body.
 * @returns the seam's normalized search result.
 */
export function mapTavilyResponse(payload: unknown): WebSearchResult {
  // A malformed 2xx body is a provider error, never a silent empty result: the
  // reference implementation threw a TypeError here (wrapped by `searchWith`
  // into `WEB_PROVIDER_ERROR … unprocessable response body`), and this port
  // preserves that contract explicitly instead of narrowing it away.
  if (payload === null || payload === undefined) {
    throw new TypeError(`Cannot read properties of ${payload === null ? 'null' : 'undefined'} (reading 'results')`)
  }
  const envelope = record(payload)
  const listed = envelope.results
  // Mirrors `(payload.results ?? [])`: absent/null results are an empty answer;
  // any other non-array value is malformed and must throw like `.map` would.
  const results: unknown = listed === null || listed === undefined ? [] : listed
  if (!Array.isArray(results)) {
    throw new TypeError('payload.results.map is not a function')
  }
  const sources: WebSearchSource[] = results
    .map((item) => {
      if (item === null || item === undefined) {
        throw new TypeError(`Cannot read properties of ${item === null ? 'null' : 'undefined'} (reading 'url')`)
      }
      const result = record(item)
      const source: { url: string, title?: string, snippet?: string, publishedAt?: string } = {
        url: String(result.url ?? ''),
      }
      if (result.title) source.title = String(result.title)
      if (result.content) source.snippet = truncateSnippet(String(result.content))
      if (result.published_date) source.publishedAt = String(result.published_date)
      return source
    })
    .filter((source) => source.url.length > 0)
  const answer = envelope.answer
  return {
    ...(typeof answer === 'string' && answer.length > 0 ? { content: answer } : {}),
    sources,
    truncated: false,
  }
}

/** Cap one result's snippet so a long `content` field cannot bloat context. */
function truncateSnippet(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > TAVILY_MAX_SNIPPET_CHARS
    ? `${trimmed.slice(0, TAVILY_MAX_SNIPPET_CHARS - 1)}…`
    : trimmed
}

/** Cap an arbitrary string for embedding in an error message. */
function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

/** True for a caller or timeout abort of the request. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** True for `AbortSignal.timeout()` firing rather than a caller cancellation. */
function isTimeoutError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError'
}
