/**
 * Provider tests against a local mock of the Tavily and Firecrawl APIs: no
 * external network, no real credentials, and full control over which status
 * each key receives. Ported from the standalone `dsh-tavily-firecrawl`
 * node:test suite; every case and assertion is preserved, plus one added case
 * that pins the versioned attribution header.
 */
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server, ServerResponse } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import { TavilySearchProvider, mapTavilyResponse, tavilyErrorMessage } from '../src/search.js'
import type { TavilySearchProviderOptions } from '../src/search.js'
import { FirecrawlFetchProvider, firecrawlErrorMessage } from '../src/fetch.js'
import type { FirecrawlFetchProviderOptions } from '../src/fetch.js'

const KEY = {
  quota: 'tvly-quota-0000000000000000',
  invalid: 'tvly-invalid-00000000000000',
  invalid2: 'tvly-invalid-11111111111111',
  badRequest: 'tvly-badrequest-0000000000',
  ok: 'tvly-primary-0000000000000',
  second: 'tvly-secondary-000000000000',
  fcQuota: 'fc-quota-00000000000000000',
  fcInvalid: 'fc-invalid-000000000000000',
  fcBadRequest: 'fc-badrequest-00000000000',
  fcOk: 'fc-primary-000000000000000',
  fcSecond: 'fc-secondary-0000000000000',
  fcTwoHundredFail: 'fc-twohundredfail-00000000',
}

/** One request the mock API saw. */
interface MockCall {
  path: string | undefined
  key: string
  body: string
  userAgent: string
}

/** Every request the mock API saw, in order. */
const calls: MockCall[] = []
let server: Server
let baseURL: string

/** Write one JSON response. */
function send(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(payload))
}

/** Tavily's documented error envelope. */
const tavilyError = (message: string) => ({ detail: { error: message } })

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString() })
    request.on('end', () => {
      const key = String(request.headers.authorization ?? '').replace(/^Bearer\s+/, '')
      calls.push({ path: request.url, key, body, userAgent: String(request.headers['user-agent'] ?? '') })
      if (request.url === '/search') {
        if (key === KEY.quota) return send(response, 432, tavilyError("This request exceeds your plan's set usage limit. Please upgrade your plan or contact support@tavily.com"))
        if (key.startsWith('tvly-invalid')) return send(response, 401, tavilyError('Unauthorized: missing or invalid API key.'))
        if (key === KEY.badRequest) return send(response, 400, tavilyError("Invalid topic. Must be 'general' or 'news'."))
        if (key === KEY.second) return send(response, 200, { answer: 'second answer', results: [{ url: 'https://example.com/b' }] })
        return send(response, 200, {
          answer: '42',
          results: [
            { url: 'https://example.com/a', title: 'A', content: 'x'.repeat(700), published_date: 'Tue, 11 Mar 2025 17:00:00 GMT' },
            { title: 'no url, dropped' },
          ],
        })
      }
      if (request.url === '/v1/scrape') {
        if (key === KEY.fcQuota) return send(response, 402, { success: false, error: 'Payment Required: no credits remaining' })
        if (key === KEY.fcInvalid) return send(response, 401, { success: false, error: 'Unauthorized: invalid API key' })
        if (key === KEY.fcBadRequest) return send(response, 400, { success: false, error: 'Invalid URL' })
        if (key === KEY.fcTwoHundredFail) {
          return send(response, 200, { success: false, error: 'Scrape blocked by robots.txt' })
        }
        if (key === KEY.fcSecond) {
          return send(response, 200, { success: true, data: { markdown: 'second page', metadata: { url: 'https://example.com/b', statusCode: 200 } } })
        }
        return send(response, 200, { success: true, data: { markdown: '# Hello', metadata: { url: 'https://example.com/', statusCode: 200 } } })
      }
      send(response, 404, { error: 'not found' })
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => resolve()) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the mock server did not bind a TCP port')
  baseURL = `http://127.0.0.1:${address.port}`
})

afterAll(() => new Promise<void>((resolve) => { server.close(() => resolve()) }))

/** Build a Tavily provider pointed at the mock API. */
function tavily(options: Partial<TavilySearchProviderOptions> = {}): TavilySearchProvider {
  return new TavilySearchProvider({
    baseURL,
    searchDepth: 'basic',
    includeAnswer: true,
    timeoutMs: 5000,
    ...options,
  })
}

/** Build a Firecrawl provider pointed at the mock API. */
function firecrawl(options: Partial<FirecrawlFetchProviderOptions> = {}): FirecrawlFetchProvider {
  return new FirecrawlFetchProvider({
    baseURL,
    timeoutMs: 5000,
    maxBodyChars: 1000,
    onlyMainContent: true,
    ...options,
  })
}

/** The rejection reason of a call that must fail, so per-assertion checks stay visible. */
async function rejectionOf(promise: Promise<unknown>): Promise<WebError> {
  try {
    await promise
  } catch (error) {
    return error as WebError
  }
  throw new Error('expected the call to reject')
}

describe('tavily provider', () => {
  it('a quota-exhausted key rotates to the next key and the call succeeds', async () => {
    const provider = tavily({ apiKeys: [KEY.quota, KEY.ok] })
    calls.length = 0
    const result = await provider.search({ query: 'hello' })
    expect(calls.map((call) => call.key)).toEqual([KEY.quota, KEY.ok])
    expect(result.content).toBe('42')
    expect(result.truncated).toBe(false)
    expect(result.sources.length).toBe(1)
    expect(result.sources[0]?.url).toBe('https://example.com/a')
    expect(result.sources[0]?.title).toBe('A')
    expect(result.sources[0]?.publishedAt).toBe('Tue, 11 Mar 2025 17:00:00 GMT')
    expect(result.sources[0]?.snippet?.length).toBe(600)
  })

  it('the cooling key is skipped by later calls, then rotation resumes', async () => {
    const provider = tavily({ apiKeys: [KEY.quota, KEY.ok] })
    calls.length = 0
    await provider.search({ query: 'first' })
    expect(calls.map((call) => call.key)).toEqual([KEY.quota, KEY.ok])
    await provider.search({ query: 'second' })
    expect(calls.map((call) => call.key)).toEqual([KEY.quota, KEY.ok, KEY.ok])
    expect(provider.pool.describe()).toMatch(/1\/2 keys ready, 1 cooling/)
  })

  it('healthy keys are used round-robin rather than sticking to the first', async () => {
    const provider = tavily({ apiKeys: [KEY.ok, KEY.second] })
    calls.length = 0
    const first = await provider.search({ query: 'one' })
    const second = await provider.search({ query: 'two' })
    expect(calls.map((call) => call.key)).toEqual([KEY.ok, KEY.second])
    expect(first.content).toBe('42')
    expect(second.content).toBe('second answer')
  })

  it('a single key keeps the familiar message and now carries Tavily\'s own reason', async () => {
    const provider = tavily({ apiKey: KEY.quota })
    const error = await rejectionOf(provider.search({ query: 'hello' }))
    expect(error.code).toBe('WEB_PROVIDER_ERROR')
    expect(error.message).toMatch(/^Tavily API error \(HTTP 432\): This request exceeds your plan's set usage limit\./)
    expect(error.message).toMatch(/TAVILY_API_KEYS/)
  })

  it('a request-level error is not blamed on the key and stops rotation', async () => {
    const provider = tavily({ apiKeys: [KEY.badRequest, KEY.ok] })
    calls.length = 0
    const error = await rejectionOf(provider.search({ query: 'hello' }))
    expect(error.message).toMatch(/Tavily API error \(HTTP 400\): Invalid topic/)
    expect(calls.map((call) => call.key)).toEqual([KEY.badRequest])
  })

  it('rejected credentials are reported with the pool state', async () => {
    const provider = tavily({ apiKeys: [KEY.invalid, KEY.invalid2] })
    const error = await rejectionOf(provider.search({ query: 'hello' }))
    expect(error.message).toMatch(/Tavily API error \(HTTP 401\) on #2 \(tvly-i…1111\): Unauthorized/)
    expect(error.message).toMatch(/\(tried 2 keys\)/)
    expect(error.message).toMatch(/2 rejected/)
  })

  it('a pool with nothing usable explains itself before any attempt', async () => {
    const provider = tavily({ apiKey: KEY.quota, quotaCooldownMs: 60000 })
    await expect(provider.search({ query: 'first' })).rejects.toThrow(/plan's set usage limit/)
    calls.length = 0
    const error = await rejectionOf(provider.search({ query: 'second' }))
    expect(error.message).toMatch(/Tavily search has no usable API key \(0\/1 key ready, 1 cooling\); next key available in \d+[smhd]/)
    expect(error.message).toMatch(/TAVILY_API_KEYS/)
    expect(calls.length, 'an unusable pool must not reach the API').toBe(0)
  })

  it('maxAttempts caps how many keys one call may burn through', async () => {
    const provider = tavily({ apiKeys: [KEY.quota, KEY.invalid, KEY.ok], maxAttempts: 2 })
    calls.length = 0
    await expect(provider.search({ query: 'hello' })).rejects.toThrow(/Tavily API error \(HTTP 401\)/)
    expect(calls.map((call) => call.key)).toEqual([KEY.quota, KEY.invalid])
  })

  it('a request maxResults reaches the API and the seam result', async () => {
    const provider = tavily({ apiKeys: [KEY.ok] })
    calls.length = 0
    await provider.search({ query: 'hello', maxResults: 5 })
    const body = JSON.parse(calls[0]?.body ?? '{}') as { max_results?: number }
    expect(body.max_results).toBe(5)
  })

  it('mapTavilyResponse drops sources without a URL and tolerates a missing answer', () => {
    const result = mapTavilyResponse({ results: [{ url: 'https://a/', content: ' short ' }] })
    expect(result.content).toBeUndefined()
    expect(result.sources).toEqual([{ url: 'https://a/', snippet: 'short' }])
    expect(result.truncated).toBe(false)
  })

  it('tavilyErrorMessage understands every envelope Tavily uses', () => {
    expect(tavilyErrorMessage({ detail: { error: 'nested' } })).toBe('nested')
    expect(tavilyErrorMessage({ detail: 'string detail' })).toBe('string detail')
    expect(tavilyErrorMessage({ error: 'plain' })).toBe('plain')
    expect(tavilyErrorMessage({ message: 'fallback' })).toBe('fallback')
    expect(tavilyErrorMessage({})).toBeUndefined()
    expect(tavilyErrorMessage(null)).toBeUndefined()
  })
})

describe('firecrawl provider', () => {
  it('a quota-refused key rotates to the next key and the page still arrives', async () => {
    const provider = firecrawl({ apiKeys: [KEY.fcQuota, KEY.fcOk] })
    calls.length = 0
    const result = await provider.fetch({ url: 'https://example.com/' })
    expect(calls.map((call) => call.key)).toEqual([KEY.fcQuota, KEY.fcOk])
    expect(result.body.content).toBe('# Hello')
    expect(result.statusCode).toBe(200)
    expect(result.url).toBe('https://example.com/')
    expect(result.truncated).toBe(false)
  })

  it('healthy keys rotate round-robin across calls', async () => {
    const provider = firecrawl({ apiKeys: [KEY.fcOk, KEY.fcSecond] })
    calls.length = 0
    const first = await provider.fetch({ url: 'https://example.com/' })
    const second = await provider.fetch({ url: 'https://example.com/same' })
    expect(calls.map((call) => call.key)).toEqual([KEY.fcOk, KEY.fcSecond])
    expect(first.body.content).toBe('# Hello')
    expect(second.body.content).toBe('second page')
  })

  it('an over-long body is truncated and flagged', async () => {
    const provider = firecrawl({ apiKey: KEY.fcOk, maxBodyChars: 4 })
    const result = await provider.fetch({ url: 'https://example.com/' })
    expect(result.body.content).toBe('# He')
    expect(result.truncated).toBe(true)
  })

  it('a single key reports Firecrawl\'s own reason', async () => {
    const provider = firecrawl({ apiKey: KEY.fcQuota })
    const error = await rejectionOf(provider.fetch({ url: 'https://example.com/' }))
    expect(error.code).toBe('WEB_PROVIDER_ERROR')
    expect(error.message).toMatch(/^Firecrawl API error \(HTTP 402\): Payment Required: no credits remaining/)
    expect(error.message).toMatch(/FIRECRAWL_API_KEYS/)
  })

  it('an invalid credential is dropped and reported', async () => {
    const provider = firecrawl({ apiKeys: [KEY.fcInvalid] })
    const error = await rejectionOf(provider.fetch({ url: 'https://example.com/' }))
    expect(error.message).toMatch(/Firecrawl API error \(HTTP 401\): Unauthorized: invalid API key/)
    expect(provider.pool.describe()).toMatch(/1 rejected/)
  })

  it('a malformed request is not blamed on the key', async () => {
    const provider = firecrawl({ apiKeys: [KEY.fcBadRequest, KEY.fcOk] })
    calls.length = 0
    await expect(provider.fetch({ url: 'not-a-url' })).rejects.toThrow(/Firecrawl API error \(HTTP 400\): Invalid URL/)
    expect(calls.map((call) => call.key)).toEqual([KEY.fcBadRequest])
  })

  it('a 2xx envelope with success:false is a provider error, not an empty page', async () => {
    const provider = firecrawl({ apiKey: KEY.fcTwoHundredFail })
    const error = await rejectionOf(provider.fetch({ url: 'https://example.com/' }))
    expect(error.code).toBe('WEB_PROVIDER_ERROR')
    expect(error.message).toMatch(/Firecrawl scrape failed: Scrape blocked by robots\.txt/)
  })

  it('firecrawlErrorMessage understands the envelopes Firecrawl uses', () => {
    expect(firecrawlErrorMessage({ success: false, error: 'plain' })).toBe('plain')
    expect(firecrawlErrorMessage({ message: 'fallback' })).toBe('fallback')
    expect(firecrawlErrorMessage({ detail: { error: 'nested' } })).toBe('nested')
    expect(firecrawlErrorMessage({ data: { error: 'deep' } })).toBe('deep')
    expect(firecrawlErrorMessage({})).toBeUndefined()
  })

  it('available() is a local check: credentials plus config shape', () => {
    expect(tavily({ apiKeys: [KEY.ok] }).available()).toBe(true)
    expect(tavily({ apiKeys: [] }).available()).toBe(false)
    expect(tavily({ apiKeys: ['   '] }).available()).toBe(false)
    expect(tavily({ apiKeys: [KEY.ok], baseURL: 'not a url' }).available()).toBe(false)
    expect(firecrawl({ apiKey: KEY.fcOk }).available()).toBe(true)
    expect(firecrawl({ apiKeys: [] }).available()).toBe(false)
    expect(firecrawl({ apiKey: KEY.fcOk, maxBodyChars: 0 }).available()).toBe(false)
  })

  it('attribution headers follow this package version instead of a frozen literal', async () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    calls.length = 0
    await tavily({ apiKey: KEY.ok }).search({ query: 'hello' })
    await firecrawl({ apiKey: KEY.fcOk }).fetch({ url: 'https://example.com/' })
    expect(calls[0]?.userAgent).toBe(`skillre-tavily-firecrawl/${manifest.version} (tavily)`)
    expect(calls[1]?.userAgent).toBe(`skillre-tavily-firecrawl/${manifest.version} (firecrawl)`)
  })
})
