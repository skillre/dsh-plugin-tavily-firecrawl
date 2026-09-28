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

import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  TAVILY_DEFAULT_BASE_URL,
  TAVILY_DEFAULT_INCLUDE_ANSWER,
  TAVILY_DEFAULT_SEARCH_DEPTH,
  TAVILY_DEFAULT_TIMEOUT_MS,
  TavilySearchProvider,
} from './search.js'
import {
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_DEFAULT_MAX_BODY_CHARS,
  FIRECRAWL_DEFAULT_ONLY_MAIN_CONTENT,
  FIRECRAWL_DEFAULT_TIMEOUT_MS,
  FirecrawlFetchProvider,
} from './fetch.js'
import { parseKeyList } from './key-pool.js'

export { TAVILY_PROVIDER_ID, TavilySearchProvider } from './search.js'
export type { TavilySearchDepth, TavilySearchProviderOptions } from './search.js'
export { FIRECRAWL_PROVIDER_ID, FirecrawlFetchProvider } from './fetch.js'
export type { FirecrawlFetchProviderOptions } from './fetch.js'
export { KEY_FAILURE, KeyPool, classifyHttpStatus, parseKeyList } from './key-pool.js'
export type { AttemptFailureLike, KeyFailureKind, KeyPoolEntry, KeyPoolOptions, KeyRotationOptions } from './key-pool.js'

/** Cordis plugin name used by loader diagnostics. Keep it stable after the first public release. */
export const name = 'skillre-tavily-firecrawl'

/** The web seam this plugin registers providers into. */
export const inject = ['web']

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export const Config = z.object({
  /** Search-side (Tavily) options. */
  search: z.object({
    /** Literal Tavily API key; prefer the launch-env fallbacks. */
    apiKey: z.string(),
    /** Tavily credential pool, rotated per request. Wins over `apiKey`. */
    apiKeys: z.array(z.string()),
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
  }),
  /** Fetch-side (Firecrawl) options. */
  fetch: z.object({
    /** Literal Firecrawl API key; prefer the launch-env fallbacks. */
    apiKey: z.string(),
    /** Firecrawl credential pool, rotated per request. Wins over `apiKey`. */
    apiKeys: z.array(z.string()),
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
  }),
  /** Register the Tavily search provider. Defaults to true. */
  searchEnabled: z.boolean(),
  /** Register the Firecrawl fetch provider. Defaults to true. */
  fetchEnabled: z.boolean(),
})

/** The validated configuration `apply` receives from the loader. */
export type PluginConfig = ReturnType<typeof Config>

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
export function resolveCredentialKeys(
  configKeys: unknown,
  configKey: unknown,
  envKeys: unknown,
  envKey: unknown,
): string[] {
  const explicit = Array.isArray(configKeys)
    ? configKeys.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter((entry) => entry.length > 0)
    : []
  if (explicit.length > 0) return explicit
  const single = singleKey(configKey)
  if (single !== undefined) return [single]
  const listed = parseKeyList(envKeys)
  if (listed.length > 0) return listed
  const inherited = singleKey(envKey)
  return inherited === undefined ? [] : [inherited]
}

/** Trim one credential candidate, treating blanks as absent. */
function singleKey(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/** Register the providers with `ctx.web`. Either side can be opted out. */
export function apply(ctx: Context, config: PluginConfig): void {
  // Every launch environment layer may name these keys (inherited env,
  // `<invocation cwd>/.env`, `$DSH_HOME/.env`); the plural form carries a list.
  const environment = launchEnvironmentOf(ctx)
  const fromEnvironment = (variableName: string): string | undefined => environment.get(variableName)?.value

  if (config.searchEnabled !== false) {
    const searchMaxResults = config.search?.maxResults
    ctx.web.registerSearchProvider(new TavilySearchProvider({
      apiKeys: resolveCredentialKeys(config.search?.apiKeys, config.search?.apiKey, fromEnvironment('TAVILY_API_KEYS'), fromEnvironment('TAVILY_API_KEY')),
      baseURL: config.search?.baseURL ?? TAVILY_DEFAULT_BASE_URL,
      searchDepth: config.search?.searchDepth ?? TAVILY_DEFAULT_SEARCH_DEPTH,
      includeAnswer: config.search?.includeAnswer ?? TAVILY_DEFAULT_INCLUDE_ANSWER,
      timeoutMs: config.search?.timeoutMs ?? TAVILY_DEFAULT_TIMEOUT_MS,
      maxAttempts: config.search?.maxAttempts,
      rateLimitCooldownMs: config.search?.rateLimitCooldownMs,
      quotaCooldownMs: config.search?.quotaCooldownMs,
      quotaCooldownMaxMs: config.search?.quotaCooldownMaxMs,
      ...(searchMaxResults !== undefined ? { maxResults: searchMaxResults } : {}),
    }))
  }
  if (config.fetchEnabled !== false) {
    ctx.web.registerFetchProvider(new FirecrawlFetchProvider({
      apiKeys: resolveCredentialKeys(config.fetch?.apiKeys, config.fetch?.apiKey, fromEnvironment('FIRECRAWL_API_KEYS'), fromEnvironment('FIRECRAWL_API_KEY')),
      baseURL: config.fetch?.baseURL ?? FIRECRAWL_DEFAULT_BASE_URL,
      timeoutMs: config.fetch?.timeoutMs ?? FIRECRAWL_DEFAULT_TIMEOUT_MS,
      maxBodyChars: config.fetch?.maxBodyChars ?? FIRECRAWL_DEFAULT_MAX_BODY_CHARS,
      onlyMainContent: config.fetch?.onlyMainContent ?? FIRECRAWL_DEFAULT_ONLY_MAIN_CONTENT,
      maxAttempts: config.fetch?.maxAttempts,
      rateLimitCooldownMs: config.fetch?.rateLimitCooldownMs,
      quotaCooldownMs: config.fetch?.quotaCooldownMs,
      quotaCooldownMaxMs: config.fetch?.quotaCooldownMaxMs,
    }))
  }
}
