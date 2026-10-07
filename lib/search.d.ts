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
import { WebError } from '@deepseek-ai/dsh-web';
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
import { KeyPool } from './key-pool.js';
import type { CredentialOptions, KeyPoolEntry, KeyRotationOptions, RotationFailure } from './key-pool.js';
/** Stable id this provider registers under. */
export declare const TAVILY_PROVIDER_ID = "tavily";
/** Default Tavily search endpoint; `/search` is the operation. */
export declare const TAVILY_DEFAULT_BASE_URL = "https://api.tavily.com";
/** Default retrieval depth: basic (fast, 1 credit) or advanced (2 credits). */
export declare const TAVILY_DEFAULT_SEARCH_DEPTH = "basic";
/** Default: ask Tavily for a synthesized answer alongside the sources. */
export declare const TAVILY_DEFAULT_INCLUDE_ANSWER = true;
/** Default per-attempt request timeout in milliseconds. */
export declare const TAVILY_DEFAULT_TIMEOUT_MS = 30000;
/** Snippet cap: Tavily's `content` field can run to thousands of characters. */
export declare const TAVILY_MAX_SNIPPET_CHARS = 600;
/** Tavily's retrieval depth control, sent as `search_depth`. */
export type TavilySearchDepth = 'basic' | 'advanced';
/** Construction options for {@link TavilySearchProvider}. */
export interface TavilySearchProviderOptions extends CredentialOptions, KeyRotationOptions {
    /** Endpoint base; `/search` is appended. */
    readonly baseURL: string;
    /** Retrieval depth sent as Tavily's `search_depth`. `basic` costs 1 credit, `advanced` 2. */
    readonly searchDepth?: TavilySearchDepth | undefined;
    /** Ask Tavily for a synthesized answer (becomes the result `content`). */
    readonly includeAnswer?: boolean | undefined;
    /** Default result count when a request carries no `maxResults`. Omitted = none. */
    readonly maxResults?: number | undefined;
    /** Per-attempt request timeout in milliseconds. */
    readonly timeoutMs?: number | undefined;
}
/**
 * The Tavily-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`.
 * `available()` is a cheap local check (at least one credential + config shape)
 * and never touches the network, per the seam's selection contract. It
 * deliberately ignores cooldowns: a pool whose keys are all cooling is still
 * "available", so the call can explain which keys are cooling instead of
 * degrading into a bare `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`.
 */
export declare class TavilySearchProvider implements WebSearchProvider {
    /** Stable registry id: `tavily`. */
    readonly id = "tavily";
    /** The options this instance was built with. */
    readonly options: TavilySearchProviderOptions;
    /** The credential rotation state. */
    readonly pool: KeyPool;
    /**
     * @param options - provider options.
     */
    constructor(options: TavilySearchProviderOptions);
    /**
     * A cheap local usability check: at least one credential and a usable config
     * shape. While the first credentials read is still in flight the pool cannot
     * yet answer, so a live key source keeps the provider selectable and the
     * request itself re-reads the credential plane before touching the API.
     */
    available(): boolean;
    /**
     * Re-read the credential plane and adopt it, keeping every key's cooldown
     * state, so a key added or removed from the configuration card reaches this
     * call.
     */
    private syncKeys;
    /**
     * Run one search, rotating to the next key when the API blames the
     * credential, until the attempt budget is spent.
     * @param request - the seam request.
     * @param signal - caller cancellation.
     * @returns the normalized search result.
     */
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
    /**
     * Run one search attempt with one credential.
     * @param entry - the pool entry to authenticate with.
     * @param request - the seam request.
     * @param maxResults - the resolved result cap.
     * @param signal - caller cancellation.
     * @returns the normalized search result.
     */
    searchWith(entry: KeyPoolEntry, request: WebSearchRequest, maxResults: number | undefined, signal: AbortSignal | undefined): Promise<WebSearchResult>;
    /**
     * Build the error for a call whose attempts all failed, or that found no
     * usable credential at all. A single-credential pool keeps the shape it had
     * before rotation existed, now carrying the API's own explanation.
     * @param failures - attempts made by this call, in order.
     * @returns the error to throw.
     */
    failureError(failures: readonly RotationFailure[]): WebError;
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
export declare function tavilyErrorMessage(payload: unknown): string | undefined;
/**
 * Map a Tavily response envelope to a normalized search result: `answer` →
 * `content`, each `results[]` entry → one source (entries without a URL are
 * dropped; `content` becomes the truncated snippet; `published_date` →
 * `publishedAt`).
 * @param payload - the parsed response body.
 * @returns the seam's normalized search result.
 */
export declare function mapTavilyResponse(payload: unknown): WebSearchResult;
