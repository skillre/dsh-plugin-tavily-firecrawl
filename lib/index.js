/**
 * `@skillre/dsh-plugin-tavily-firecrawl`: a combined bundle plugin registering
 * TWO web providers with `ctx.web`:
 *   - search: Tavily (`POST /search`) → the `web_search` tool
 *   - fetch:  Firecrawl (`POST /v1/scrape`, markdown) → the `web_fetch` tool
 *
 * A function/namespace plugin (NOT a default-export service): providers
 * register INTO the seam's registry, mirroring the shipped
 * `dsh-web-search-deepseek` and `dsh-web-fetch-http` packages. One entry, one
 * apply — the bundle patch wires the seam in a single step, so
 * `dsh plugin add @skillre/dsh-plugin-tavily-firecrawl` is all an installation
 * needs.
 *
 * Both sides accept a POOL of credentials (`apiKeys`, or the plural environment
 * variables `TAVILY_API_KEYS` / `FIRECRAWL_API_KEYS`). Free plans are small, so
 * several accounts can be listed and a request that one key refuses continues on
 * the next usable one, spreading usage instead of failing the tool call.
 * @module @skillre/dsh-plugin-tavily-firecrawl
 */
import z from '@deepseek-ai/schemastery';
import { CredentialKeys, readVolatile } from './credential-keys.js';
import { TAVILY_DEFAULT_BASE_URL, TAVILY_DEFAULT_INCLUDE_ANSWER, TAVILY_DEFAULT_SEARCH_DEPTH, TAVILY_DEFAULT_TIMEOUT_MS, TavilySearchProvider, } from './search.js';
import { FIRECRAWL_DEFAULT_BASE_URL, FIRECRAWL_DEFAULT_MAX_BODY_CHARS, FIRECRAWL_DEFAULT_ONLY_MAIN_CONTENT, FIRECRAWL_DEFAULT_TIMEOUT_MS, FirecrawlFetchProvider, } from './fetch.js';
import { parseKeyList } from './key-pool.js';
export { TAVILY_PROVIDER_ID, TavilySearchProvider } from './search.js';
export { FIRECRAWL_PROVIDER_ID, FirecrawlFetchProvider } from './fetch.js';
export { KEY_FAILURE, KeyPool, classifyHttpStatus, maskKey, parseKeyList, trimBaseURL } from './key-pool.js';
/** Cordis plugin name used by loader diagnostics. Keep it stable after the first public release. */
export const name = 'skillre-tavily-firecrawl';
/** The web seam this plugin registers providers into. */
export const inject = ['web'];
/**
 * The `search.*` fields {@link Config} declares, as one dict: the schema and
 * the unknown-key guard below are built from this object, so a field can never
 * be added to the schema without the guard accepting it (or vice versa).
 *
 * The credential fields are marked `.volatile()` and `.role('secret')`:
 * `volatile` is what puts this entry on the configuration surface (the settings
 * service only describes schemas with live fields) and lets a committed change
 * reach the running plugin without a remount, while `secret` keeps the literal
 * off the wire — a configuration surface receives it redacted and writes it
 * back through the redaction-aware path.
 */
const SEARCH_FIELDS = {
    /** Literal Tavily API key; prefer the credential reference or the launch environment. */
    apiKey: z.string().role('secret').volatile(),
    /** Tavily credential pool, rotated per request. Wins over `apiKey`. */
    apiKeys: z.array(z.string()).role('secret').volatile(),
    /** Endpoint base; `/search` is appended. Defaults to the public API. */
    baseURL: z.string(),
    /** Retrieval depth sent as Tavily's `search_depth`. `basic` costs 1 credit, `advanced` 2. */
    searchDepth: z.union(['basic', 'advanced']),
    /** Ask Tavily for a synthesized answer (becomes the result `content`). */
    includeAnswer: z.boolean(),
    /** Default result count when a request carries no `maxResults`. Omitted = none. */
    maxResults: z.number().step(1).min(1),
    /** Per-attempt request timeout in milliseconds. */
    timeoutMs: z.number().step(1).min(1),
    /** How many pool keys one call may try. Defaults to the pool size. */
    maxAttempts: z.number().step(1).min(1),
    /** Cooldown after Tavily refuses a key with HTTP 429. */
    rateLimitCooldownMs: z.number().step(1).min(1),
    /** First cooldown after Tavily refuses a key with a plan/quota status. */
    quotaCooldownMs: z.number().step(1).min(1),
    /** Ceiling for the escalating quota cooldown. */
    quotaCooldownMaxMs: z.number().step(1).min(1),
};
/** The `fetch.*` fields {@link Config} declares; see {@link SEARCH_FIELDS}. */
const FETCH_FIELDS = {
    /** Literal Firecrawl API key; prefer the credential reference or the launch environment. */
    apiKey: z.string().role('secret').volatile(),
    /** Firecrawl credential pool, rotated per request. Wins over `apiKey`. */
    apiKeys: z.array(z.string()).role('secret').volatile(),
    /** Endpoint base; `/v1/scrape` is appended. Defaults to the public API. */
    baseURL: z.string(),
    /** Provider-side request timeout in milliseconds. */
    timeoutMs: z.number().step(1).min(1),
    /** Cap on the markdown body carried in a result (chars). */
    maxBodyChars: z.number().step(1).min(1),
    /** Extract only the page's main content. */
    onlyMainContent: z.boolean(),
    /** How many pool keys one call may try. Defaults to the pool size. */
    maxAttempts: z.number().step(1).min(1),
    /** Cooldown after Firecrawl refuses a key with HTTP 429. */
    rateLimitCooldownMs: z.number().step(1).min(1),
    /** First cooldown after Firecrawl refuses a key with a plan/quota status. */
    quotaCooldownMs: z.number().step(1).min(1),
    /** Ceiling for the escalating quota cooldown. */
    quotaCooldownMaxMs: z.number().step(1).min(1),
};
/** The root fields {@link Config} declares; see {@link SEARCH_FIELDS}. */
const ROOT_FIELDS = {
    /** Search-side (Tavily) options. */
    search: z.object(SEARCH_FIELDS),
    /** Fetch-side (Firecrawl) options. */
    fetch: z.object(FETCH_FIELDS),
    /** Register the Tavily search provider. Defaults to true. */
    searchEnabled: z.boolean(),
    /** Register the Firecrawl fetch provider. Defaults to true. */
    fetchEnabled: z.boolean(),
};
/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export const Config = z.object(ROOT_FIELDS);
/** Root keys {@link Config} accepts: derived from the schema, never restated. */
const KNOWN_ROOT_KEYS = Object.keys(ROOT_FIELDS);
/** `search.*` keys {@link Config} accepts: derived from the schema. */
const KNOWN_SEARCH_KEYS = Object.keys(SEARCH_FIELDS);
/** `fetch.*` keys {@link Config} accepts: derived from the schema. */
const KNOWN_FETCH_KEYS = Object.keys(FETCH_FIELDS);
/** Read one configuration object's own keys; absent sections read as no keys. */
function configKeys(section) {
    return typeof section === 'object' && section !== null ? Object.keys(section) : [];
}
/**
 * Reject configuration keys the schema does not declare.
 *
 * Schemastery's object schema accepts and preserves unknown keys instead of
 * failing, so a mistyped row (`serach:`, `searchDepthh:`) would otherwise be
 * loaded, silently ignored, and leave the deployment on defaults with no
 * diagnostic anywhere. Fleet policy requires configuration to fail loudly, so
 * `apply` refuses such a row before registering anything — the Loader then
 * reports this message against the row instead of a half-applied plugin.
 * @param config - the validated configuration `apply` received.
 * @throws when any key (root, `search.*`, or `fetch.*`) is not declared by {@link Config}.
 */
export function assertKnownConfigKeys(config) {
    const unknown = [];
    const collect = (keys, known, prefix = '') => {
        for (const key of keys)
            if (!known.includes(key))
                unknown.push(`${prefix}${key}`);
    };
    collect(configKeys(config), KNOWN_ROOT_KEYS);
    collect(configKeys(config.search), KNOWN_SEARCH_KEYS, 'search.');
    collect(configKeys(config.fetch), KNOWN_FETCH_KEYS, 'fetch.');
    if (unknown.length > 0) {
        throw new Error(`unknown configuration key(s) rejected: ${unknown.join(', ')}. `
            + 'Check the spelling against the Configuration section of README.md.');
    }
}
/**
 * Resolve one provider's credential list. Explicit configuration wins over the
 * environment, and the plural form wins over the singular one at each level, so
 * a pool can be added without disturbing a deployed single-key setup.
 * @param configKeys - `search.apiKeys` / `fetch.apiKeys`.
 * @param configKey - `search.apiKey` / `fetch.apiKey`.
 * @param envKeys - the plural launch-environment value.
 * @param envKey - the singular launch-environment value.
 * @returns credentials in rotation order; empty when none is configured.
 */
export function resolveCredentialKeys(configKeys, configKey, envKeys, envKey) {
    const explicit = Array.isArray(configKeys)
        ? configKeys.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter((entry) => entry.length > 0)
        : [];
    if (explicit.length > 0)
        return explicit;
    const single = singleKey(configKey);
    if (single !== undefined)
        return [single];
    const listed = parseKeyList(envKeys);
    if (listed.length > 0)
        return listed;
    const inherited = singleKey(envKey);
    return inherited === undefined ? [] : [inherited];
}
/** Credential reference this plugin resolves for Tavily keys (list form). */
export const TAVILY_CREDENTIAL_REF = 'TAVILY_API_KEYS';
/** Credential reference this plugin resolves for one Tavily key (single form). */
export const TAVILY_CREDENTIAL_REF_SINGULAR = 'TAVILY_API_KEY';
/** Credential reference this plugin resolves for Firecrawl keys (list form). */
export const FIRECRAWL_CREDENTIAL_REF = 'FIRECRAWL_API_KEYS';
/** Credential reference this plugin resolves for one Firecrawl key (single form). */
export const FIRECRAWL_CREDENTIAL_REF_SINGULAR = 'FIRECRAWL_API_KEY';
/** Trim one credential candidate, treating blanks as absent. */
function singleKey(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
/**
 * Tie one side's credential source to its provider for the life of this fiber:
 * every settled refresh reconciles the provider's pool (so a key written from
 * the configuration page reaches the registry without a restart), the first
 * read starts immediately, and the credential/config listeners are attached
 * until the fiber tears down.
 * @param ctx - the plugin context.
 * @param source - the side's credential source.
 * @param provider - the side's provider, when that side is enabled.
 * @param onFirstEmpty - called once if the first read settles without a credential.
 */
function followCredentialSource(ctx, source, provider, onFirstEmpty) {
    let reported = false;
    ctx.effect(() => {
        const stopObserve = source.observe((keys) => {
            provider?.pool.reconcile(keys);
            if (reported)
                return;
            reported = true;
            if (keys.length === 0)
                onFirstEmpty();
        });
        void source.refresh();
        const stopWatch = source.watch();
        return () => {
            stopObserve();
            stopWatch();
        };
    }, 'skillre-tavily-firecrawl: credential source');
}
/** Register the providers with `ctx.web`. Either side can be opted out. */
export function apply(ctx, config) {
    // Schemastery keeps unknown keys, so a typo would otherwise load silently.
    assertKnownConfigKeys(config);
    // Credentials are read live: configuration wins, then the credentials
    // domain (`TAVILY_API_KEY(S)` / `FIRECRAWL_API_KEY(S)` — the reference the
    // configuration page writes), then the launch environment. Reading them
    // through a source instead of a frozen list is what lets a key added from
    // the plugin's configuration page reach the next request without a restart.
    const searchKeys = new CredentialKeys(ctx, {
        configured: () => resolveCredentialKeys(readVolatile(config.search?.apiKeys), readVolatile(config.search?.apiKey), undefined, undefined),
        ref: TAVILY_CREDENTIAL_REF,
        singularRef: TAVILY_CREDENTIAL_REF_SINGULAR,
    });
    const fetchKeys = new CredentialKeys(ctx, {
        configured: () => resolveCredentialKeys(readVolatile(config.fetch?.apiKeys), readVolatile(config.fetch?.apiKey), undefined, undefined),
        ref: FIRECRAWL_CREDENTIAL_REF,
        singularRef: FIRECRAWL_CREDENTIAL_REF_SINGULAR,
    });
    const searchProvider = config.searchEnabled === false ? undefined : new TavilySearchProvider({
        keySource: searchKeys,
        baseURL: config.search?.baseURL ?? TAVILY_DEFAULT_BASE_URL,
        searchDepth: config.search?.searchDepth ?? TAVILY_DEFAULT_SEARCH_DEPTH,
        includeAnswer: config.search?.includeAnswer ?? TAVILY_DEFAULT_INCLUDE_ANSWER,
        timeoutMs: config.search?.timeoutMs ?? TAVILY_DEFAULT_TIMEOUT_MS,
        maxAttempts: config.search?.maxAttempts,
        rateLimitCooldownMs: config.search?.rateLimitCooldownMs,
        quotaCooldownMs: config.search?.quotaCooldownMs,
        quotaCooldownMaxMs: config.search?.quotaCooldownMaxMs,
        ...(config.search?.maxResults !== undefined ? { maxResults: config.search.maxResults } : {}),
    });
    const fetchProvider = config.fetchEnabled === false ? undefined : new FirecrawlFetchProvider({
        keySource: fetchKeys,
        baseURL: config.fetch?.baseURL ?? FIRECRAWL_DEFAULT_BASE_URL,
        timeoutMs: config.fetch?.timeoutMs ?? FIRECRAWL_DEFAULT_TIMEOUT_MS,
        maxBodyChars: config.fetch?.maxBodyChars ?? FIRECRAWL_DEFAULT_MAX_BODY_CHARS,
        onlyMainContent: config.fetch?.onlyMainContent ?? FIRECRAWL_DEFAULT_ONLY_MAIN_CONTENT,
        maxAttempts: config.fetch?.maxAttempts,
        rateLimitCooldownMs: config.fetch?.rateLimitCooldownMs,
        quotaCooldownMs: config.fetch?.quotaCooldownMs,
        quotaCooldownMaxMs: config.fetch?.quotaCooldownMaxMs,
    });
    // The bundle patch pins both ids to this plugin, so an unkeyed side cannot
    // fall through to another provider: say so once the first credential read
    // settles instead of leaving only a generic tool-side
    // WEB_PROVIDER_CONFIGURED_UNAVAILABLE on the first call.
    followCredentialSource(ctx, searchKeys, searchProvider, () => {
        ctx.logger.warn('tavily search registered without an API key: web_search stays unavailable until `search.apiKeys`, TAVILY_API_KEY(S), or the plugin configuration page supplies one');
    });
    followCredentialSource(ctx, fetchKeys, fetchProvider, () => {
        ctx.logger.warn('firecrawl fetch registered without an API key: web_fetch stays unavailable until `fetch.apiKeys`, FIRECRAWL_API_KEY(S), or the plugin configuration page supplies one');
    });
    if (searchProvider !== undefined)
        ctx.web.registerSearchProvider(searchProvider);
    if (fetchProvider !== undefined)
        ctx.web.registerFetchProvider(fetchProvider);
}
