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
import { readFileSync } from 'node:fs';
import { WebError } from '@deepseek-ai/dsh-web';
import { AttemptFailure, KEY_FAILURE, KeyPool, TRANSIENT_FAILURE, classifyHttpStatus, collectKeys, rotationMessage, trimBaseURL, } from './key-pool.js';
/** Stable id this provider registers under. */
export const FIRECRAWL_PROVIDER_ID = 'firecrawl';
/** Default Firecrawl API base; `/v1/scrape` is the operation. */
export const FIRECRAWL_DEFAULT_BASE_URL = 'https://api.firecrawl.dev';
/** Default provider-side request timeout in milliseconds. */
export const FIRECRAWL_DEFAULT_TIMEOUT_MS = 30000;
/** Default cap on the markdown body carried in a result (chars). */
export const FIRECRAWL_DEFAULT_MAX_BODY_CHARS = 200000;
/** Default: extract only the page's main content. */
export const FIRECRAWL_DEFAULT_ONLY_MAIN_CONTENT = true;
/** Cap on a provider error message copied into a `WebError`. */
const MAX_ERROR_CHARS = 240;
/**
 * This package's own version, read from the manifest that ships beside the
 * built file. The attribution header must never drift from the released
 * package, and both layouts (`src/` under vitest, `lib/` once built) keep
 * `package.json` one directory above the module.
 * @returns the manifest version, or `0.0.0` when it cannot be read.
 */
function packageVersion() {
    try {
        const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        return typeof manifest.version === 'string' && manifest.version.length > 0 ? manifest.version : '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
/** Attribution header sent on every request; the version follows the package. */
const USER_AGENT = `skillre-tavily-firecrawl/${packageVersion()} (firecrawl)`;
/**
 * The Firecrawl-backed fetch provider. `available()` is a cheap local check
 * (credential + config shape); it never touches the network. Cooldowns do not
 * make a pool unavailable — the call itself explains which keys are cooling.
 */
export class FirecrawlFetchProvider {
    /** Stable registry id: `firecrawl`. */
    id = FIRECRAWL_PROVIDER_ID;
    /** The options this instance was built with. */
    options;
    /** The credential rotation state. */
    pool;
    /**
     * @param options - provider options.
     */
    constructor(options) {
        this.options = { ...options, baseURL: trimBaseURL(options.baseURL) };
        this.pool = new KeyPool(collectKeys(this.options), {
            rateLimitCooldownMs: options.rateLimitCooldownMs,
            quotaCooldownMs: options.quotaCooldownMs,
            quotaCooldownMaxMs: options.quotaCooldownMaxMs,
        });
    }
    /**
     * A cheap local usability check: credential plus config shape. While the
     * first credentials read is still in flight the pool cannot yet answer, so a
     * live key source keeps the provider selectable and the request itself
     * re-reads the credential plane before touching the API.
     */
    available() {
        const usable = this.pool.size > 0 || this.options.keySource?.isWarming() === true;
        return usable
            && URL.canParse(this.options.baseURL)
            && Number.isInteger(this.options.timeoutMs) && this.options.timeoutMs > 0
            && Number.isInteger(this.options.maxBodyChars) && this.options.maxBodyChars > 0;
    }
    /**
     * Re-read the credential plane and adopt it, keeping every key's cooldown
     * state, so a key added or removed from the configuration card reaches this
     * call.
     */
    async syncKeys() {
        const source = this.options.keySource;
        if (source === undefined)
            return;
        this.pool.reconcile(await source.refresh());
    }
    /**
     * Retrieve one URL, rotating to the next key when the scrape API blames the
     * credential, until the attempt budget is spent.
     * @param request - the seam request.
     * @param signal - caller cancellation.
     * @returns the seam's fetch result.
     */
    async fetch(request, signal) {
        await this.syncKeys();
        const attempts = Math.max(1, Math.min(this.options.maxAttempts ?? this.pool.size, this.pool.size));
        const failures = [];
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            const entry = this.pool.next();
            if (entry === undefined)
                break;
            try {
                const result = await this.scrapeWith(entry, request, signal);
                this.pool.reportSuccess(entry);
                return result;
            }
            catch (error) {
                if (!(error instanceof AttemptFailure))
                    throw error;
                if (error.kind !== undefined && error.kind !== TRANSIENT_FAILURE) {
                    this.pool.reportFailure(entry, error.kind, `HTTP ${error.status}: ${error.message}`);
                }
                failures.push({ entry, error });
                if (!error.retryable)
                    break;
            }
        }
        throw this.failureError(failures);
    }
    /**
     * Run one scrape attempt with one credential.
     * @param entry - the pool entry to authenticate with.
     * @param request - the seam request.
     * @param signal - caller cancellation.
     * @returns the seam's fetch result.
     */
    async scrapeWith(entry, request, signal) {
        // One signal stops the request; the provider's own timeout bounds an
        // absent or leisurely caller signal (the tool also forwards its own).
        const combined = signal !== undefined
            ? AbortSignal.any([signal, AbortSignal.timeout(this.options.timeoutMs)])
            : AbortSignal.timeout(this.options.timeoutMs);
        let response;
        try {
            response = await fetch(`${this.options.baseURL}/v1/scrape`, {
                method: 'POST',
                redirect: 'error',
                signal: combined,
                headers: {
                    authorization: `Bearer ${entry.key}`,
                    'content-type': 'application/json',
                    'user-agent': USER_AGENT,
                },
                body: JSON.stringify({
                    url: request.url,
                    formats: ['markdown'],
                    onlyMainContent: this.options.onlyMainContent,
                }),
            });
        }
        catch (error) {
            if (signal !== undefined && signal.aborted)
                throw new WebError('Firecrawl fetch aborted', 'WEB_ABORTED', { cause: error });
            if (isAbortError(error))
                throw new WebError('Firecrawl fetch aborted', 'WEB_ABORTED', { cause: error });
            if (isTimeoutError(error)) {
                throw new WebError(`Firecrawl fetch timed out after ${this.options.timeoutMs} ms`, 'WEB_PROVIDER_ERROR', { cause: error });
            }
            throw new WebError(`Firecrawl fetch request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error });
        }
        let payload;
        try {
            payload = await response.json();
        }
        catch (error) {
            if (isAbortError(error))
                throw new WebError('Firecrawl fetch aborted', 'WEB_ABORTED', { cause: error });
            if (!response.ok) {
                throw new AttemptFailure(response.status, classifyHttpStatus(response.status), `${response.statusText || 'request failed'} (unparsable error body)`);
            }
            throw new WebError(`Firecrawl returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error });
        }
        // The scrape API itself refused the request (bad key, quota, throttle, …).
        if (!response.ok) {
            const message = firecrawlErrorMessage(payload) ?? `${response.statusText || 'request failed'} (no error detail in the response body)`;
            throw new AttemptFailure(response.status, classifyHttpStatus(response.status), truncate(message, MAX_ERROR_CHARS));
        }
        // A 2xx envelope can still carry `success: false` (Firecrawl reports some
        // validation failures this way instead of with a status code).
        if (record(payload).success === false) {
            const message = firecrawlErrorMessage(payload) ?? 'unknown error';
            throw new WebError(`Firecrawl scrape failed: ${truncate(message, MAX_ERROR_CHARS)}`, 'WEB_PROVIDER_ERROR');
        }
        const data = record(record(payload).data);
        const metadata = record(data.metadata);
        const markdown = typeof data.markdown === 'string' ? data.markdown : '';
        const finalUrl = typeof metadata.url === 'string' && metadata.url.length > 0
            ? metadata.url
            : request.url;
        const statusCode = typeof metadata.statusCode === 'number' ? metadata.statusCode : response.status;
        const truncated = markdown.length > this.options.maxBodyChars;
        return {
            url: finalUrl,
            statusCode,
            // The seam's WebFetchBody arms carry the payload as `content`
            // (`{ kind: 'text'; content: string }`), not `text` — the wrong field
            // name made tool-web map `content: undefined`, failing the tool's
            // lossless-JSON output validation with INVALID_TOOL_OUTPUT.
            body: { kind: 'text', content: truncated ? markdown.slice(0, this.options.maxBodyChars) : markdown },
            truncated,
        };
    }
    /**
     * Build the error for a call whose attempts all failed.
     * @param failures - attempts made by this call, in order.
     * @returns the error to throw.
     */
    failureError(failures) {
        const quota = failures.some((failure) => failure.error.kind === KEY_FAILURE.QUOTA)
            || this.pool.entries.some((entry) => entry.quotaStrikes > 0);
        const hint = this.pool.size === 1 && quota
            ? 'Add more credentials with `fetch.apiKeys` or `FIRECRAWL_API_KEYS` to rotate accounts.'
            : '';
        return new WebError(rotationMessage({ failure: 'Firecrawl API error', empty: 'Firecrawl fetch' }, this.pool, failures, { hint }), 'WEB_PROVIDER_ERROR');
    }
}
/** Read an unknown JSON value as a string-keyed record; non-objects read as empty. */
function record(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}
/**
 * Extract the human-readable reason from a Firecrawl error envelope
 * (`{"success":false,"error":"…"}`), tolerating the shapes its gateway and
 * validation errors use in practice.
 * @param payload - the parsed response body.
 * @returns the message, or `undefined` when the body carries none.
 */
export function firecrawlErrorMessage(payload) {
    const envelope = record(payload);
    const candidates = [
        envelope.error,
        envelope.message,
        envelope.detail,
        record(envelope.data).error,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim().length > 0)
            return candidate.trim();
        if (typeof candidate === 'object' && candidate !== null) {
            const nested = record(candidate);
            const inner = nested.error ?? nested.message;
            if (typeof inner === 'string' && inner.trim().length > 0)
                return inner.trim();
        }
    }
    return undefined;
}
/** Cap an arbitrary string for embedding in an error message. */
function truncate(text, limit) {
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
/** True for a caller-induced abort. */
function isAbortError(error) {
    return error instanceof DOMException && error.name === 'AbortError';
}
/** True for `AbortSignal.timeout()` firing rather than a caller cancellation. */
function isTimeoutError(error) {
    return error instanceof DOMException && error.name === 'TimeoutError';
}
