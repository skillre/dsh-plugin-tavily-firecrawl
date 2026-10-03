/**
 * Unit tests for the credential rotation primitive. No network, no DSH.
 * Ported from the standalone `dsh-tavily-firecrawl` node:test suite; every case
 * and assertion is preserved.
 */
import { describe, expect, it } from 'vitest'
import {
  KEY_FAILURE,
  MASK_MIN_KEY_LENGTH,
  KeyPool,
  TRANSIENT_FAILURE,
  classifyHttpStatus,
  formatWait,
  maskKey,
  parseKeyList,
  rotationMessage,
  trimBaseURL,
} from '../src/key-pool.js'
import type { KeyPoolEntry } from '../src/key-pool.js'

/** The next ready credential, or a loud failure when the pool has none. */
function take(pool: KeyPool): KeyPoolEntry {
  const entry = pool.next()
  if (entry === undefined) throw new Error('expected a ready credential')
  return entry
}

/** The pool entry for one credential. */
function entryFor(pool: KeyPool, key: string): KeyPoolEntry {
  const entry = pool.entries.find((candidate) => candidate.key === key)
  if (entry === undefined) throw new Error(`expected a pool entry for ${key}`)
  return entry
}

describe('key-pool', () => {
  it('parseKeyList splits on commas, semicolons, and whitespace', () => {
    expect(parseKeyList('a,b;c\nd  e')).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(parseKeyList('  ')).toEqual([])
    expect(parseKeyList('')).toEqual([])
    expect(parseKeyList(undefined)).toEqual([])
    expect(parseKeyList(['a'])).toEqual([])
  })

  it('maskKey keeps a short key opaque and shows a masked tail otherwise', () => {
    expect(maskKey('short', 0)).toBe('#1')
    expect(maskKey('tvly-dev-abcdefghijklmnop', 1)).toBe('#2 (tvly-d…mnop)')
  })

  it('maskKey never prints a tail that gives most of a short secret away', () => {
    // A fixed 6+4 mask on an 11-character key would reveal 10 of its 11
    // characters, so anything at or below the threshold is named by position.
    expect(maskKey('tvly-123456', 0)).toBe('#1')
    expect(maskKey('x'.repeat(MASK_MIN_KEY_LENGTH), 0)).toBe('#1')
    expect(maskKey('x'.repeat(MASK_MIN_KEY_LENGTH + 1), 0)).toBe('#1 (xxxxxx…xxxx)')
  })

  it('trimBaseURL removes trailing slashes and nothing else', () => {
    expect(trimBaseURL('https://api.tavily.com')).toBe('https://api.tavily.com')
    expect(trimBaseURL('https://api.tavily.com/')).toBe('https://api.tavily.com')
    expect(trimBaseURL('https://api.tavily.com///')).toBe('https://api.tavily.com')
    // An unusable base stays unusable so `available()` keeps rejecting it.
    expect(trimBaseURL('not a url')).toBe('not a url')
    expect(trimBaseURL('/')).toBe('')
  })

  it('formatWait renders seconds, minutes, hours, days, and never', () => {
    expect(formatWait(42000)).toBe('42s')
    expect(formatWait(300000)).toBe('5m')
    expect(formatWait(9000000)).toBe('2.5h')
    expect(formatWait(103680000)).toBe('29h')
    expect(formatWait(207360000)).toBe('2.4d')
    expect(formatWait(Number.POSITIVE_INFINITY)).toBe('never')
  })

  it('classifyHttpStatus separates credentials, quota, throttle, and transient', () => {
    expect(classifyHttpStatus(401)).toBe(KEY_FAILURE.INVALID)
    expect(classifyHttpStatus(429)).toBe(KEY_FAILURE.RATE)
    expect(classifyHttpStatus(432)).toBe(KEY_FAILURE.QUOTA)
    expect(classifyHttpStatus(433)).toBe(KEY_FAILURE.QUOTA)
    expect(classifyHttpStatus(402)).toBe(KEY_FAILURE.QUOTA)
    expect(classifyHttpStatus(403)).toBe(KEY_FAILURE.QUOTA)
    expect(classifyHttpStatus(503)).toBe(TRANSIENT_FAILURE)
    expect(classifyHttpStatus(400)).toBeUndefined()
    expect(classifyHttpStatus(404)).toBeUndefined()
  })

  it('KeyPool collapses duplicates and blanks', () => {
    const pool = new KeyPool(['a', ' a ', 'b', '', '   ', null, undefined])
    expect(pool.size).toBe(2)
    expect(pool.ready().map((entry) => entry.key)).toEqual(['a', 'b'])
  })

  it('KeyPool hands out credentials round-robin without repeats until wrapped', () => {
    const pool = new KeyPool(['a', 'b', 'c'])
    expect(pool.next()?.key).toBe('a')
    expect(pool.next()?.key).toBe('b')
    expect(pool.next()?.key).toBe('c')
    expect(pool.next()?.key).toBe('a')
  })

  it('a rate-limit refusal cools the key down and rotation skips it', () => {
    const pool = new KeyPool(['a', 'b'], { rateLimitCooldownMs: 5000 })
    const first = take(pool)
    pool.reportFailure(first, KEY_FAILURE.RATE, 'HTTP 429: slow down')
    expect(pool.ready().length).toBe(1)
    expect(pool.next()?.key).toBe('b')
    expect(pool.next()?.key).toBe('b')
    expect(entryFor(pool, 'a').coolingUntil > Date.now()).toBe(true)
    expect(pool.describe()).toMatch(/1\/2 keys ready, 1 cooling/)
    // While one key is still ready there is nothing to wait for; once every key
    // is cooling, the wait names the soonest recovery.
    expect(pool.retryAfterMs()).toBe(0)
    pool.reportFailure(entryFor(pool, 'b'), KEY_FAILURE.RATE, 'HTTP 429: slow down')
    expect(pool.retryAfterMs()).toBeGreaterThan(0)
  })

  it('a cooled-down key returns to rotation once its cooldown expires', async () => {
    const pool = new KeyPool(['a', 'b'], { rateLimitCooldownMs: 30 })
    pool.reportFailure(take(pool), KEY_FAILURE.RATE, 'HTTP 429: slow down')
    expect(pool.ready().length).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(pool.ready().length).toBe(2)
  })

  it('an invalid credential is dropped for the rest of the process', () => {
    const pool = new KeyPool(['a'])
    const entry = take(pool)
    pool.reportFailure(entry, KEY_FAILURE.INVALID, 'HTTP 401: nope')
    expect(entry.dead).toBe(true)
    expect(pool.next()).toBeUndefined()
    expect(pool.retryAfterMs()).toBe(Number.POSITIVE_INFINITY)
    expect(pool.describe()).toMatch(/0\/1 key ready, 1 rejected/)
  })

  it('a successful call clears the cooldown a key had accumulated', () => {
    const pool = new KeyPool(['a'])
    const entry = take(pool)
    pool.reportFailure(entry, KEY_FAILURE.QUOTA, 'HTTP 432: plan limit')
    expect(entry.quotaStrikes).toBe(1)
    pool.reportSuccess(entry)
    expect(entry.quotaStrikes).toBe(0)
    expect(entry.coolingUntil).toBe(0)
    expect(entry.lastError).toBeUndefined()
    expect(pool.ready().length).toBe(1)
  })

  it('quota cooldowns escalate and stop at the configured ceiling', () => {
    const pool = new KeyPool(['a'], { quotaCooldownMs: 1000, quotaCooldownMaxMs: 2500 })
    const entry = take(pool)
    const cooldownAfterFailure = () => {
      pool.reportFailure(entry, KEY_FAILURE.QUOTA, 'HTTP 432: plan limit')
      return entry.coolingUntil - Date.now()
    }
    const first = cooldownAfterFailure()
    const second = cooldownAfterFailure()
    const third = cooldownAfterFailure()
    const fourth = cooldownAfterFailure()
    expect(first >= 900 && first <= 1100, `first cooldown was ${first}`).toBe(true)
    expect(second >= 1900 && second <= 2100, `second cooldown was ${second}`).toBe(true)
    expect(third >= 2400 && third <= 2600, `third cooldown was ${third}`).toBe(true)
    expect(fourth >= 2400 && fourth <= 2600, `fourth cooldown was ${fourth}`).toBe(true)
    expect(entry.quotaStrikes).toBe(4)
  })

  it('reasons() lists struck keys, caps the list, and hides untouched keys', () => {
    const pool = new KeyPool([
      'tvly-aaaaaaaaaaaaaaaa',
      'tvly-bbbbbbbbbbbbbbbb',
      'tvly-cccccccccccc',
      'tvly-dddddddddddd',
      'tvly-eeeeeeeeeeee',
    ])
    pool.reportFailure(take(pool), KEY_FAILURE.QUOTA, 'HTTP 432: plan limit')
    pool.reportFailure(take(pool), KEY_FAILURE.INVALID, 'HTTP 401: nope')
    pool.reportFailure(take(pool), KEY_FAILURE.RATE, 'HTTP 429: slow down')
    const reasons = pool.reasons(2)
    expect(reasons).toMatch(/#1 \(tvly-a…aaaa\)/)
    expect(reasons).toMatch(/rejected \(invalid key\)/)
    expect(reasons).toMatch(/\+1 more/)
    expect(reasons.includes('#3')).toBe(false)
    expect(reasons.includes('#5')).toBe(false)
  })

  it('rotationMessage keeps the single-key shape and adds the API reason', () => {
    const pool = new KeyPool(['tvly-singlekey-0123456789'])
    const entry = take(pool)
    const error = Object.assign(new Error('This request exceeds your plan\'s set usage limit.'), { status: 432, kind: KEY_FAILURE.QUOTA })
    pool.reportFailure(entry, KEY_FAILURE.QUOTA, 'HTTP 432: plan limit')
    const message = rotationMessage({ failure: 'Tavily API error', empty: 'Tavily search' }, pool, [{ entry, error }], { hint: ' HINT' })
    expect(message).toBe('Tavily API error (HTTP 432): This request exceeds your plan\'s set usage limit. HINT')
  })

  it('rotationMessage names the pool state when several keys were tried', () => {
    const pool = new KeyPool(['tvly-aaaaaaaaaaaaaaaa', 'tvly-bbbbbbbbbbbbbbbb'], { quotaCooldownMs: 600000 })
    const first = take(pool)
    const second = take(pool)
    pool.reportFailure(first, KEY_FAILURE.QUOTA, 'HTTP 432: plan limit')
    pool.reportFailure(second, KEY_FAILURE.RATE, 'HTTP 429: slow down')
    const message = rotationMessage(
      { failure: 'Tavily API error', empty: 'Tavily search' },
      pool,
      [
        { entry: first, error: Object.assign(new Error('plan limit'), { status: 432, kind: KEY_FAILURE.QUOTA }) },
        { entry: second, error: Object.assign(new Error('slow down'), { status: 429, kind: KEY_FAILURE.RATE }) },
      ],
    )
    expect(message).toMatch(/Tavily API error \(HTTP 429\) on #2 \(tvly-b…bbbb\): slow down \(tried 2 keys\)/)
    expect(message).toMatch(/0\/2 keys ready/)
    expect(message).toMatch(/next key in/)
  })

  it('rotationMessage explains a pool with nothing usable before any attempt', () => {
    const pool = new KeyPool(['tvly-aaaaaaaaaaaaaaaa', 'tvly-bbbbbbbbbbbbbbbb'])
    pool.reportFailure(take(pool), KEY_FAILURE.INVALID, 'HTTP 401: nope')
    pool.reportFailure(take(pool), KEY_FAILURE.QUOTA, 'HTTP 432: plan limit')
    const message = rotationMessage({ failure: 'Tavily API error', empty: 'Tavily search' }, pool, [], { hint: '' })
    expect(message).toMatch(/Tavily search has no usable API key \(0\/2 keys ready, 1 cooling, 1 rejected\)/)
    expect(message).toMatch(/next key available in/)
    expect(message).toMatch(/#1 \(tvly-a…aaaa\) rejected \(invalid key\)/)
  })
})
