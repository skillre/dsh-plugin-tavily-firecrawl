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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export { TAVILY_PROVIDER_ID, TavilySearchProvider } from './search.js';
export type { TavilySearchDepth, TavilySearchProviderOptions } from './search.js';
export { FIRECRAWL_PROVIDER_ID, FirecrawlFetchProvider } from './fetch.js';
export type { FirecrawlFetchProviderOptions } from './fetch.js';
export { KEY_FAILURE, KeyPool, classifyHttpStatus, maskKey, parseKeyList, trimBaseURL } from './key-pool.js';
export type { AttemptFailureLike, KeyFailureKind, KeyPoolEntry, KeyPoolOptions, KeyRotationOptions } from './key-pool.js';
/** Cordis plugin name used by loader diagnostics. Keep it stable after the first public release. */
export declare const name = "skillre-tavily-firecrawl";
/** The web seam this plugin registers providers into. */
export declare const inject: string[];
/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    /** Search-side (Tavily) options. */
    search: z<Schemastery.ObjectS<NoInfer<{
        /** Literal Tavily API key; prefer the credential reference or the launch environment. */
        apiKey: z<string, string, "volatile">;
        /** Tavily credential pool, rotated per request. Wins over `apiKey`. */
        apiKeys: z<NoInfer<string[]>, NoInfer<string[]>, "volatile">;
        /** Endpoint base; `/search` is appended. Defaults to the public API. */
        baseURL: z<string, string, "plain">;
        /** Retrieval depth sent as Tavily's `search_depth`. `basic` costs 1 credit, `advanced` 2. */
        searchDepth: z<"basic" | "advanced", "basic" | "advanced", "plain">;
        /** Ask Tavily for a synthesized answer (becomes the result `content`). */
        includeAnswer: z<boolean, boolean, "plain">;
        /** Default result count when a request carries no `maxResults`. Omitted = none. */
        maxResults: z<number, number, "plain">;
        /** Per-attempt request timeout in milliseconds. */
        timeoutMs: z<number, number, "plain">;
        /** How many pool keys one call may try. Defaults to the pool size. */
        maxAttempts: z<number, number, "plain">;
        /** Cooldown after Tavily refuses a key with HTTP 429. */
        rateLimitCooldownMs: z<number, number, "plain">;
        /** First cooldown after Tavily refuses a key with a plan/quota status. */
        quotaCooldownMs: z<number, number, "plain">;
        /** Ceiling for the escalating quota cooldown. */
        quotaCooldownMaxMs: z<number, number, "plain">;
    }>>, Schemastery.ObjectT<NoInfer<{
        /** Literal Tavily API key; prefer the credential reference or the launch environment. */
        apiKey: z<string, string, "volatile">;
        /** Tavily credential pool, rotated per request. Wins over `apiKey`. */
        apiKeys: z<NoInfer<string[]>, NoInfer<string[]>, "volatile">;
        /** Endpoint base; `/search` is appended. Defaults to the public API. */
        baseURL: z<string, string, "plain">;
        /** Retrieval depth sent as Tavily's `search_depth`. `basic` costs 1 credit, `advanced` 2. */
        searchDepth: z<"basic" | "advanced", "basic" | "advanced", "plain">;
        /** Ask Tavily for a synthesized answer (becomes the result `content`). */
        includeAnswer: z<boolean, boolean, "plain">;
        /** Default result count when a request carries no `maxResults`. Omitted = none. */
        maxResults: z<number, number, "plain">;
        /** Per-attempt request timeout in milliseconds. */
        timeoutMs: z<number, number, "plain">;
        /** How many pool keys one call may try. Defaults to the pool size. */
        maxAttempts: z<number, number, "plain">;
        /** Cooldown after Tavily refuses a key with HTTP 429. */
        rateLimitCooldownMs: z<number, number, "plain">;
        /** First cooldown after Tavily refuses a key with a plan/quota status. */
        quotaCooldownMs: z<number, number, "plain">;
        /** Ceiling for the escalating quota cooldown. */
        quotaCooldownMaxMs: z<number, number, "plain">;
    }>>, "plain">;
    /** Fetch-side (Firecrawl) options. */
    fetch: z<Schemastery.ObjectS<NoInfer<{
        /** Literal Firecrawl API key; prefer the credential reference or the launch environment. */
        apiKey: z<string, string, "volatile">;
        /** Firecrawl credential pool, rotated per request. Wins over `apiKey`. */
        apiKeys: z<NoInfer<string[]>, NoInfer<string[]>, "volatile">;
        /** Endpoint base; `/v1/scrape` is appended. Defaults to the public API. */
        baseURL: z<string, string, "plain">;
        /** Provider-side request timeout in milliseconds. */
        timeoutMs: z<number, number, "plain">;
        /** Cap on the markdown body carried in a result (chars). */
        maxBodyChars: z<number, number, "plain">;
        /** Extract only the page's main content. */
        onlyMainContent: z<boolean, boolean, "plain">;
        /** How many pool keys one call may try. Defaults to the pool size. */
        maxAttempts: z<number, number, "plain">;
        /** Cooldown after Firecrawl refuses a key with HTTP 429. */
        rateLimitCooldownMs: z<number, number, "plain">;
        /** First cooldown after Firecrawl refuses a key with a plan/quota status. */
        quotaCooldownMs: z<number, number, "plain">;
        /** Ceiling for the escalating quota cooldown. */
        quotaCooldownMaxMs: z<number, number, "plain">;
    }>>, Schemastery.ObjectT<NoInfer<{
        /** Literal Firecrawl API key; prefer the credential reference or the launch environment. */
        apiKey: z<string, string, "volatile">;
        /** Firecrawl credential pool, rotated per request. Wins over `apiKey`. */
        apiKeys: z<NoInfer<string[]>, NoInfer<string[]>, "volatile">;
        /** Endpoint base; `/v1/scrape` is appended. Defaults to the public API. */
        baseURL: z<string, string, "plain">;
        /** Provider-side request timeout in milliseconds. */
        timeoutMs: z<number, number, "plain">;
        /** Cap on the markdown body carried in a result (chars). */
        maxBodyChars: z<number, number, "plain">;
        /** Extract only the page's main content. */
        onlyMainContent: z<boolean, boolean, "plain">;
        /** How many pool keys one call may try. Defaults to the pool size. */
        maxAttempts: z<number, number, "plain">;
        /** Cooldown after Firecrawl refuses a key with HTTP 429. */
        rateLimitCooldownMs: z<number, number, "plain">;
        /** First cooldown after Firecrawl refuses a key with a plan/quota status. */
        quotaCooldownMs: z<number, number, "plain">;
        /** Ceiling for the escalating quota cooldown. */
        quotaCooldownMaxMs: z<number, number, "plain">;
    }>>, "plain">;
    /** Register the Tavily search provider. Defaults to true. */
    searchEnabled: z<boolean, boolean, "plain">;
    /** Register the Firecrawl fetch provider. Defaults to true. */
    fetchEnabled: z<boolean, boolean, "plain">;
}>>, Schemastery.ObjectT<NoInfer<{
    /** Search-side (Tavily) options. */
    search: z<Schemastery.ObjectS<NoInfer<{
        /** Literal Tavily API key; prefer the credential reference or the launch environment. */
        apiKey: z<string, string, "volatile">;
        /** Tavily credential pool, rotated per request. Wins over `apiKey`. */
        apiKeys: z<NoInfer<string[]>, NoInfer<string[]>, "volatile">;
        /** Endpoint base; `/search` is appended. Defaults to the public API. */
        baseURL: z<string, string, "plain">;
        /** Retrieval depth sent as Tavily's `search_depth`. `basic` costs 1 credit, `advanced` 2. */
        searchDepth: z<"basic" | "advanced", "basic" | "advanced", "plain">;
        /** Ask Tavily for a synthesized answer (becomes the result `content`). */
        includeAnswer: z<boolean, boolean, "plain">;
        /** Default result count when a request carries no `maxResults`. Omitted = none. */
        maxResults: z<number, number, "plain">;
        /** Per-attempt request timeout in milliseconds. */
        timeoutMs: z<number, number, "plain">;
        /** How many pool keys one call may try. Defaults to the pool size. */
        maxAttempts: z<number, number, "plain">;
        /** Cooldown after Tavily refuses a key with HTTP 429. */
        rateLimitCooldownMs: z<number, number, "plain">;
        /** First cooldown after Tavily refuses a key with a plan/quota status. */
        quotaCooldownMs: z<number, number, "plain">;
        /** Ceiling for the escalating quota cooldown. */
        quotaCooldownMaxMs: z<number, number, "plain">;
    }>>, Schemastery.ObjectT<NoInfer<{
        /** Literal Tavily API key; prefer the credential reference or the launch environment. */
        apiKey: z<string, string, "volatile">;
        /** Tavily credential pool, rotated per request. Wins over `apiKey`. */
        apiKeys: z<NoInfer<string[]>, NoInfer<string[]>, "volatile">;
        /** Endpoint base; `/search` is appended. Defaults to the public API. */
        baseURL: z<string, string, "plain">;
        /** Retrieval depth sent as Tavily's `search_depth`. `basic` costs 1 credit, `advanced` 2. */
        searchDepth: z<"basic" | "advanced", "basic" | "advanced", "plain">;
        /** Ask Tavily for a synthesized answer (becomes the result `content`). */
        includeAnswer: z<boolean, boolean, "plain">;
        /** Default result count when a request carries no `maxResults`. Omitted = none. */
        maxResults: z<number, number, "plain">;
        /** Per-attempt request timeout in milliseconds. */
        timeoutMs: z<number, number, "plain">;
        /** How many pool keys one call may try. Defaults to the pool size. */
        maxAttempts: z<number, number, "plain">;
        /** Cooldown after Tavily refuses a key with HTTP 429. */
        rateLimitCooldownMs: z<number, number, "plain">;
        /** First cooldown after Tavily refuses a key with a plan/quota status. */
        quotaCooldownMs: z<number, number, "plain">;
        /** Ceiling for the escalating quota cooldown. */
        quotaCooldownMaxMs: z<number, number, "plain">;
    }>>, "plain">;
    /** Fetch-side (Firecrawl) options. */
    fetch: z<Schemastery.ObjectS<NoInfer<{
        /** Literal Firecrawl API key; prefer the credential reference or the launch environment. */
        apiKey: z<string, string, "volatile">;
        /** Firecrawl credential pool, rotated per request. Wins over `apiKey`. */
        apiKeys: z<NoInfer<string[]>, NoInfer<string[]>, "volatile">;
        /** Endpoint base; `/v1/scrape` is appended. Defaults to the public API. */
        baseURL: z<string, string, "plain">;
        /** Provider-side request timeout in milliseconds. */
        timeoutMs: z<number, number, "plain">;
        /** Cap on the markdown body carried in a result (chars). */
        maxBodyChars: z<number, number, "plain">;
        /** Extract only the page's main content. */
        onlyMainContent: z<boolean, boolean, "plain">;
        /** How many pool keys one call may try. Defaults to the pool size. */
        maxAttempts: z<number, number, "plain">;
        /** Cooldown after Firecrawl refuses a key with HTTP 429. */
        rateLimitCooldownMs: z<number, number, "plain">;
        /** First cooldown after Firecrawl refuses a key with a plan/quota status. */
        quotaCooldownMs: z<number, number, "plain">;
        /** Ceiling for the escalating quota cooldown. */
        quotaCooldownMaxMs: z<number, number, "plain">;
    }>>, Schemastery.ObjectT<NoInfer<{
        /** Literal Firecrawl API key; prefer the credential reference or the launch environment. */
        apiKey: z<string, string, "volatile">;
        /** Firecrawl credential pool, rotated per request. Wins over `apiKey`. */
        apiKeys: z<NoInfer<string[]>, NoInfer<string[]>, "volatile">;
        /** Endpoint base; `/v1/scrape` is appended. Defaults to the public API. */
        baseURL: z<string, string, "plain">;
        /** Provider-side request timeout in milliseconds. */
        timeoutMs: z<number, number, "plain">;
        /** Cap on the markdown body carried in a result (chars). */
        maxBodyChars: z<number, number, "plain">;
        /** Extract only the page's main content. */
        onlyMainContent: z<boolean, boolean, "plain">;
        /** How many pool keys one call may try. Defaults to the pool size. */
        maxAttempts: z<number, number, "plain">;
        /** Cooldown after Firecrawl refuses a key with HTTP 429. */
        rateLimitCooldownMs: z<number, number, "plain">;
        /** First cooldown after Firecrawl refuses a key with a plan/quota status. */
        quotaCooldownMs: z<number, number, "plain">;
        /** Ceiling for the escalating quota cooldown. */
        quotaCooldownMaxMs: z<number, number, "plain">;
    }>>, "plain">;
    /** Register the Tavily search provider. Defaults to true. */
    searchEnabled: z<boolean, boolean, "plain">;
    /** Register the Firecrawl fetch provider. Defaults to true. */
    fetchEnabled: z<boolean, boolean, "plain">;
}>>, "plain">;
/** The validated configuration `apply` receives from the loader. */
export type PluginConfig = ReturnType<typeof Config>;
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
export declare function assertKnownConfigKeys(config: PluginConfig): void;
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
export declare function resolveCredentialKeys(configKeys: unknown, configKey: unknown, envKeys: unknown, envKey: unknown): string[];
/** Credential reference this plugin resolves for Tavily keys (list form). */
export declare const TAVILY_CREDENTIAL_REF = "TAVILY_API_KEYS";
/** Credential reference this plugin resolves for one Tavily key (single form). */
export declare const TAVILY_CREDENTIAL_REF_SINGULAR = "TAVILY_API_KEY";
/** Credential reference this plugin resolves for Firecrawl keys (list form). */
export declare const FIRECRAWL_CREDENTIAL_REF = "FIRECRAWL_API_KEYS";
/** Credential reference this plugin resolves for one Firecrawl key (single form). */
export declare const FIRECRAWL_CREDENTIAL_REF_SINGULAR = "FIRECRAWL_API_KEY";
/** Register the providers with `ctx.web`. Either side can be opted out. */
export declare function apply(ctx: Context, config: PluginConfig): void;
