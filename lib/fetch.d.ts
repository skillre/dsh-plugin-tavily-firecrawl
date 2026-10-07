/**
 * `FirecrawlFetchProvider`: a `WebFetchProvider` backed by Firecrawl's scrape
 * API (`POST /v1/scrape`, `formats: ['markdown']`). Maps the returned markdown
 * into the seam's `{ kind: 'text' }` body.
 *
 * Two statuses must not be confused:
 *   - the SCRAPED PAGE's status arrives inside a successful API response
 *     (`data.metadata.statusCode`) and is returned as a result, never thrown —
 *     a non-2xx page is a result, per the fetch seam's contract;
 *   - the SCRAPE API's own status (credential, quota, rate limit) is a provider
 *     failure. Credential/quota answers rotate to the next key; other API
 *     failures raise `WEB_PROVIDER_ERROR` with Firecrawl's own explanation
 *     instead of masquerading as an empty page result.
 * @module @skillre/dsh-plugin-tavily-firecrawl/fetch
 */
import { WebError } from '@deepseek-ai/dsh-web';
import type { WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web';
import { KeyPool } from './key-pool.js';
import type { CredentialOptions, KeyPoolEntry, KeyRotationOptions, RotationFailure } from './key-pool.js';
/** Stable id this provider registers under. */
export declare const FIRECRAWL_PROVIDER_ID = "firecrawl";
/** Default Firecrawl API base; `/v1/scrape` is the operation. */
export declare const FIRECRAWL_DEFAULT_BASE_URL = "https://api.firecrawl.dev";
/** Default provider-side request timeout in milliseconds. */
export declare const FIRECRAWL_DEFAULT_TIMEOUT_MS = 30000;
/** Default cap on the markdown body carried in a result (chars). */
export declare const FIRECRAWL_DEFAULT_MAX_BODY_CHARS = 200000;
/** Default: extract only the page's main content. */
export declare const FIRECRAWL_DEFAULT_ONLY_MAIN_CONTENT = true;
/** Construction options for {@link FirecrawlFetchProvider}. */
export interface FirecrawlFetchProviderOptions extends CredentialOptions, KeyRotationOptions {
    /** Endpoint base; `/v1/scrape` is appended. */
    readonly baseURL: string;
    /** Per-attempt request timeout in milliseconds. */
    readonly timeoutMs: number;
    /** Cap on the markdown body carried in a result (chars). */
    readonly maxBodyChars: number;
    /** Extract only the page's main content. */
    readonly onlyMainContent?: boolean | undefined;
}
/**
 * The Firecrawl-backed fetch provider. `available()` is a cheap local check
 * (credential + config shape); it never touches the network. Cooldowns do not
 * make a pool unavailable — the call itself explains which keys are cooling.
 */
export declare class FirecrawlFetchProvider implements WebFetchProvider {
    /** Stable registry id: `firecrawl`. */
    readonly id = "firecrawl";
    /** The options this instance was built with. */
    readonly options: FirecrawlFetchProviderOptions;
    /** The credential rotation state. */
    readonly pool: KeyPool;
    /**
     * @param options - provider options.
     */
    constructor(options: FirecrawlFetchProviderOptions);
    /**
     * A cheap local usability check: credential plus config shape. While the
     * first credentials read is still in flight the pool cannot yet answer, so a
     * live key source keeps the provider selectable and the request itself
     * re-reads the credential plane before touching the API.
     */
    available(): boolean;
    /**
     * Re-read the credential plane and adopt it, keeping every key's cooldown
     * state, so a key added or removed from the configuration card reaches this
     * call.
     */
    private syncKeys;
    /**
     * Retrieve one URL, rotating to the next key when the scrape API blames the
     * credential, until the attempt budget is spent.
     * @param request - the seam request.
     * @param signal - caller cancellation.
     * @returns the seam's fetch result.
     */
    fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult>;
    /**
     * Run one scrape attempt with one credential.
     * @param entry - the pool entry to authenticate with.
     * @param request - the seam request.
     * @param signal - caller cancellation.
     * @returns the seam's fetch result.
     */
    scrapeWith(entry: KeyPoolEntry, request: WebFetchRequest, signal: AbortSignal | undefined): Promise<WebFetchResult>;
    /**
     * Build the error for a call whose attempts all failed.
     * @param failures - attempts made by this call, in order.
     * @returns the error to throw.
     */
    failureError(failures: readonly RotationFailure[]): WebError;
}
/**
 * Extract the human-readable reason from a Firecrawl error envelope
 * (`{"success":false,"error":"…"}`), tolerating the shapes its gateway and
 * validation errors use in practice.
 * @param payload - the parsed response body.
 * @returns the message, or `undefined` when the body carries none.
 */
export declare function firecrawlErrorMessage(payload: unknown): string | undefined;
