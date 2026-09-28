#!/usr/bin/env node
/**
 * Live smoke check: call the real Tavily and Firecrawl APIs with the
 * credentials the DSH launch environment would supply, and print what each
 * side answers.
 *
 * This is a repository-only tool: it is not part of the published package and
 * it imports the BUILT output, so run `npm run build` first. It never prints a
 * credential — only masked labels and the API's own words. Run it after
 * changing credentials or rotation defaults:
 *
 *   npm run build
 *   TAVILY_API_KEYS=tvly-…,tvly-… node scripts/live-smoke.mjs
 *   node scripts/live-smoke.mjs --env ~/.dsh/.env
 *
 * A HTTP 432 from Tavily means the account is over its plan limit, which is
 * exactly the case a rotation pool is meant to survive: the run continues on
 * the next key instead of failing the call.
 */
import { readFileSync } from 'node:fs'
import { FirecrawlFetchProvider } from '../lib/fetch.js'
import { TavilySearchProvider } from '../lib/search.js'

/** Read a `.env` file into a variable map without mutating `process.env`. */
function readEnvFile(path) {
  const values = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (match === null) continue
    values[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return values
}

const envFileArgument = process.argv.indexOf('--env')
const fileValues = envFileArgument === -1 ? {} : readEnvFile(process.argv[envFileArgument + 1])
const lookup = (name) => process.env[name] ?? fileValues[name]

const tavilyKeys = lookup('TAVILY_API_KEYS') ?? lookup('TAVILY_API_KEY') ?? ''
const firecrawlKeys = lookup('FIRECRAWL_API_KEYS') ?? lookup('FIRECRAWL_API_KEY') ?? ''

if (tavilyKeys.trim().length === 0 && firecrawlKeys.trim().length === 0) {
  process.stderr.write('no credentials found: set TAVILY_API_KEYS / FIRECRAWL_API_KEYS (or pass --env <file>)\n')
  process.exit(2)
}

/** Run one provider call and print a masked verdict. */
async function check(label, run) {
  const started = Date.now()
  try {
    const detail = await run()
    process.stdout.write(`✔ ${label} (${Date.now() - started} ms): ${detail}\n`)
    return true
  } catch (error) {
    process.stdout.write(`✖ ${label} (${Date.now() - started} ms): ${error.message}\n`)
    return false
  }
}

const results = []
if (tavilyKeys.trim().length > 0) {
  const provider = new TavilySearchProvider({
    apiKeys: tavilyKeys.split(/[\s,;]+/).filter((key) => key.length > 0),
    baseURL: 'https://api.tavily.com',
    searchDepth: 'basic',
    includeAnswer: true,
    timeoutMs: 30000,
  })
  results.push(await check(`Tavily search (${provider.pool.describe()})`, async () => {
    const result = await provider.search({ query: 'DeepSeek Harness', maxResults: 3 })
    const first = result.sources[0]?.url ?? '(no sources)'
    return `${result.sources.length} sources, first ${first}`
  }))
}

if (firecrawlKeys.trim().length > 0) {
  const provider = new FirecrawlFetchProvider({
    apiKeys: firecrawlKeys.split(/[\s,;]+/).filter((key) => key.length > 0),
    baseURL: 'https://api.firecrawl.dev',
    timeoutMs: 30000,
    maxBodyChars: 200000,
    onlyMainContent: true,
  })
  results.push(await check(`Firecrawl fetch (${provider.pool.describe()})`, async () => {
    const result = await provider.fetch({ url: 'https://example.com' })
    return `HTTP ${result.statusCode}, ${result.body.content.length} chars of ${result.body.kind}`
  }))
}

process.exit(results.every(Boolean) ? 0 : 1)
