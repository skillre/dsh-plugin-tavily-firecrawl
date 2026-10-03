/**
 * Integration tests for the plugin entry: config schema, credential
 * precedence, and what actually reaches the web seam's registries.
 * Ported from the standalone `dsh-tavily-firecrawl` node:test suite; every case
 * and assertion is preserved (the plugin name is the fleet-namespaced one).
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { Config, apply, inject, name, resolveCredentialKeys } from '../src/index.js'
import { TAVILY_DEFAULT_BASE_URL, TAVILY_DEFAULT_SEARCH_DEPTH } from '../src/search.js'
import type { TavilySearchProvider } from '../src/search.js'
import { FIRECRAWL_DEFAULT_BASE_URL, FIRECRAWL_DEFAULT_MAX_BODY_CHARS, FIRECRAWL_DEFAULT_TIMEOUT_MS } from '../src/fetch.js'
import type { FirecrawlFetchProvider } from '../src/fetch.js'

/** The validated configuration the loader hands `apply`. */
type ConfiguredConfig = ReturnType<typeof Config>

/** The raw configuration shape the schema accepts. */
type PluginConfigInput = NonNullable<Parameters<typeof Config>[0]>

/**
 * Parse config the way the loader does before `apply` sees it. The parameter is
 * deliberately the schema's raw input type: one case hands it a malformed value
 * to prove the schema rejects it instead of silently ignoring it.
 */
const configure = (config: PluginConfigInput): ConfiguredConfig => Config(config)

/** The single provider one side registered. */
function only<T>(providers: readonly T[]): T {
  const [provider] = providers
  if (provider === undefined) throw new Error('expected exactly one registered provider')
  return provider
}

/**
 * A minimal stand-in for the context the loader hands `apply`: the web seam's
 * two registration points, the launch-environment snapshot and the logger that
 * reports an unkeyed pool. The double is asserted into the seam's shape
 * deliberately, because a real Cordis `Context` carries the whole plugin
 * runtime and only these members are read.
 * @param environment - the variables this launch provides.
 */
function fakeContext(environment: Record<string, string> = {}) {
  const registered = { search: [] as TavilySearchProvider[], fetch: [] as FirecrawlFetchProvider[] }
  const warnings: string[] = []
  const ctx = {
    web: {
      registerSearchProvider(provider: TavilySearchProvider) {
        registered.search.push(provider)
        return () => {}
      },
      registerFetchProvider(provider: FirecrawlFetchProvider) {
        registered.fetch.push(provider)
        return () => {}
      },
    },
    logger: {
      warn(message: string) {
        warnings.push(String(message))
      },
    },
    get(serviceName: string) {
      if (serviceName !== 'launchEnvironment') return undefined
      return { get: (variableName: string) => (environment[variableName] === undefined ? undefined : { value: environment[variableName] }) }
    },
  } as unknown as Context
  return { registered, warnings, ctx }
}

describe('plugin entry', () => {
  it('the plugin is a web-seam row named for loader diagnostics', () => {
    expect(name).toBe('skillre-tavily-firecrawl')
    expect(inject).toEqual(['web'])
  })

  it('defaults register both providers with the documented endpoints', () => {
    const { ctx, registered } = fakeContext()
    apply(ctx, configure({}))
    expect(registered.search.length).toBe(1)
    expect(registered.fetch.length).toBe(1)
    const search = only(registered.search)
    const fetch = only(registered.fetch)
    expect(search.id).toBe('tavily')
    expect(fetch.id).toBe('firecrawl')
    expect(search.options.baseURL).toBe(TAVILY_DEFAULT_BASE_URL)
    expect(search.options.searchDepth).toBe(TAVILY_DEFAULT_SEARCH_DEPTH)
    expect(fetch.options.baseURL).toBe(FIRECRAWL_DEFAULT_BASE_URL)
    expect(fetch.options.maxBodyChars).toBe(FIRECRAWL_DEFAULT_MAX_BODY_CHARS)
    expect(fetch.options.timeoutMs).toBe(FIRECRAWL_DEFAULT_TIMEOUT_MS)
    // No credential anywhere: registered, but the seam will not select it.
    expect(search.available()).toBe(false)
    expect(fetch.available()).toBe(false)
  })

  it('a single environment key still configures each provider', () => {
    const { ctx, registered } = fakeContext({
      TAVILY_API_KEY: 'tvly-single',
      FIRECRAWL_API_KEY: 'fc-single',
    })
    apply(ctx, configure({}))
    expect(registered.search[0]?.pool.entries.map((entry) => entry.key)).toEqual(['tvly-single'])
    expect(registered.fetch[0]?.pool.entries.map((entry) => entry.key)).toEqual(['fc-single'])
    expect(only(registered.search).available()).toBe(true)
  })

  it('the plural environment variable supplies the whole rotation pool', () => {
    const { ctx, registered } = fakeContext({ TAVILY_API_KEYS: 'tvly-a, tvly-b\ntvly-c', FIRECRAWL_API_KEYS: 'fc-a;fc-b' })
    apply(ctx, configure({}))
    expect(registered.search[0]?.pool.entries.map((entry) => entry.key)).toEqual(['tvly-a', 'tvly-b', 'tvly-c'])
    expect(registered.fetch[0]?.pool.entries.map((entry) => entry.key)).toEqual(['fc-a', 'fc-b'])
  })

  it('the plural environment variable wins over the singular one', () => {
    const { ctx, registered } = fakeContext({ TAVILY_API_KEYS: 'tvly-list-1,tvly-list-2', TAVILY_API_KEY: 'tvly-single' })
    apply(ctx, configure({}))
    expect(registered.search[0]?.pool.entries.map((entry) => entry.key)).toEqual(['tvly-list-1', 'tvly-list-2'])
  })

  it('explicit config wins over the environment, plural over singular', () => {
    const { ctx, registered } = fakeContext({ TAVILY_API_KEYS: 'env-1,env-2', FIRECRAWL_API_KEY: 'env-fc' })
    apply(ctx, configure({
      search: { apiKeys: ['cfg-1', 'cfg-2', 'cfg-3'] },
      fetch: { apiKey: 'cfg-fc' },
    }))
    expect(registered.search[0]?.pool.entries.map((entry) => entry.key)).toEqual(['cfg-1', 'cfg-2', 'cfg-3'])
    expect(registered.fetch[0]?.pool.entries.map((entry) => entry.key)).toEqual(['cfg-fc'])

    const singular = fakeContext({ TAVILY_API_KEYS: 'env-1,env-2' })
    apply(singular.ctx, configure({ search: { apiKey: 'cfg-single' }, searchEnabled: true }))
    expect(singular.registered.search[0]?.pool.entries.map((entry) => entry.key)).toEqual(['cfg-single'])
  })

  it('each side can be opted out', () => {
    const { ctx, registered } = fakeContext({ TAVILY_API_KEY: 'tvly', FIRECRAWL_API_KEY: 'fc' })
    apply(ctx, configure({ searchEnabled: false }))
    expect(registered.search.length).toBe(0)
    expect(registered.fetch.length).toBe(1)

    const fetchOff = fakeContext({ TAVILY_API_KEY: 'tvly', FIRECRAWL_API_KEY: 'fc' })
    apply(fetchOff.ctx, configure({ fetchEnabled: false }))
    expect(fetchOff.registered.search.length).toBe(1)
    expect(fetchOff.registered.fetch.length).toBe(0)
  })

  it('rotation tuning and limits travel from config to the providers', () => {
    const { ctx, registered } = fakeContext()
    apply(ctx, configure({
      search: {
        apiKeys: ['a', 'b'],
        searchDepth: 'advanced',
        includeAnswer: false,
        maxResults: 3,
        timeoutMs: 12000,
        maxAttempts: 2,
        quotaCooldownMs: 900000,
      },
      fetch: {
        apiKeys: ['c'],
        timeoutMs: 8000,
        maxBodyChars: 4096,
        onlyMainContent: false,
        rateLimitCooldownMs: 15000,
      },
    }))
    const search = only(registered.search)
    const fetch = only(registered.fetch)
    expect(search.options.searchDepth).toBe('advanced')
    expect(search.options.includeAnswer).toBe(false)
    expect(search.options.maxResults).toBe(3)
    expect(search.options.timeoutMs).toBe(12000)
    expect(search.options.maxAttempts).toBe(2)
    expect(search.pool.quotaCooldownMs).toBe(900000)
    expect(fetch.options.maxBodyChars).toBe(4096)
    expect(fetch.options.onlyMainContent).toBe(false)
    expect(fetch.pool.rateLimitCooldownMs).toBe(15000)
  })

  it('the schema rejects malformed configuration instead of silently ignoring it', () => {
    // These values are intentionally outside the schema's types, so the raw
    // input is asserted into the schema call the way a bad cordis row would.
    const raw = (value: unknown) => value as PluginConfigInput
    expect(() => configure(raw({ search: { apiKeys: 'not-an-array' } }))).toThrow()
    expect(() => configure(raw({ search: { searchDepth: 'deepest' } }))).toThrow()
    expect(() => configure(raw({ fetch: { maxBodyChars: 0 } }))).toThrow()
  })

  it('resolveCredentialKeys follows the documented precedence', () => {
    expect(resolveCredentialKeys(['a', ' b ', ''], undefined, 'env', 'single')).toEqual(['a', 'b'])
    expect(resolveCredentialKeys([], 'single-cfg', 'env-1,env-2', 'env-single')).toEqual(['single-cfg'])
    expect(resolveCredentialKeys(undefined, undefined, 'env-1,env-2', 'env-single')).toEqual(['env-1', 'env-2'])
    expect(resolveCredentialKeys(undefined, undefined, undefined, ' env-single ')).toEqual(['env-single'])
    expect(resolveCredentialKeys(undefined, '   ', '', '')).toEqual([])
    expect(resolveCredentialKeys(undefined, undefined, undefined, undefined)).toEqual([])
  })

  it('a side enabled without a credential warns at load, and warns about it by name', () => {
    const { ctx, warnings } = fakeContext()
    apply(ctx, configure({}))
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toMatch(/tavily search registered without an API key/)
    expect(warnings[1]).toMatch(/firecrawl fetch registered without an API key/)
  })

  it('a keyed pool registers without any warning', () => {
    const { ctx, warnings } = fakeContext({ TAVILY_API_KEY: 'tvly-single', FIRECRAWL_API_KEY: 'fc-single' })
    apply(ctx, configure({}))
    expect(warnings).toEqual([])
  })

  it('unknown configuration keys are rejected instead of silently ignored', () => {
    const { ctx, registered } = fakeContext()
    const reject = (raw: unknown) => () => apply(ctx, configure(raw as PluginConfigInput))
    // Schemastery keeps unknown keys, so without this guard each typo below
    // would load, do nothing, and leave the deployment on its defaults.
    expect(reject({ serach: { apiKey: 'x' } })).toThrow(/unknown configuration key\(s\) rejected: serach/)
    expect(reject({ search: { searchDepthh: 'basic' } })).toThrow(/search\.searchDepthh/)
    expect(reject({ fetch: { maxBodyChar: 10 } })).toThrow(/fetch\.maxBodyChar/)
    expect(registered.search.length, 'a rejected row must register nothing').toBe(0)
    expect(registered.fetch.length, 'a rejected row must register nothing').toBe(0)
  })

  it('every key the schema declares is accepted by the unknown-key guard', () => {
    const { ctx, registered } = fakeContext({ TAVILY_API_KEY: 'tvly-single', FIRECRAWL_API_KEY: 'fc-single' })
    apply(ctx, configure({
      search: {
        apiKey: 'cfg-single',
        apiKeys: ['cfg-a'],
        baseURL: 'https://api.tavily.com',
        searchDepth: 'advanced',
        includeAnswer: false,
        maxResults: 4,
        timeoutMs: 12000,
        maxAttempts: 2,
        rateLimitCooldownMs: 15000,
        quotaCooldownMs: 900000,
        quotaCooldownMaxMs: 7200000,
      },
      fetch: {
        apiKey: 'fc-cfg',
        apiKeys: ['fc-a'],
        baseURL: 'https://api.firecrawl.dev',
        timeoutMs: 8000,
        maxBodyChars: 4096,
        onlyMainContent: false,
        maxAttempts: 2,
        rateLimitCooldownMs: 15000,
        quotaCooldownMs: 900000,
        quotaCooldownMaxMs: 7200000,
      },
      searchEnabled: true,
      fetchEnabled: true,
    }))
    expect(registered.search.length).toBe(1)
    expect(registered.fetch.length).toBe(1)
  })
})
