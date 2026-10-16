import test from 'node:test'
import assert from 'node:assert/strict'
import { PoliteFetcher, HostBlockedError } from '../scraper/lib/http.mjs'

// RFC Retry-After permits either delay-seconds or an HTTP-date. Entire
// transport is an in-process fake; no retailer URLs, DNS, sockets or traffic.
const URL = 'https://shop.example.test/catalog/fictional'
const CLOCK = Date.parse('2026-10-16T12:00:00.000Z')

function setup(retryAfter) {
  const calls = []
  const sleeps = []
  const fetcher = new PoliteFetcher({
    now: () => CLOCK, respectRobots: false, retries: 0,
    minDelayMs: 0, sleepImpl: async (ms) => { sleeps.push(ms) },
    fetchImpl: async (url, opts) => {
      assert.equal(url, URL)
      assert.equal(opts.redirect, 'manual')
      calls.push(url)
      const status = calls.length < 2 ? 429 : 200
      return {
        url, status, ok: status === 200,
        headers: { get(name) {
          return name.toLowerCase() === 'retry-after' ? retryAfter : null
        } },
        body: { async cancel() {} },
        async arrayBuffer() { return Uint8Array.from([79,75]).buffer },
      }
    },
  })
  return { fetcher, sleeps, calls }
}

test('a future standard HTTP-date Retry-After controls 429 cooldown [EXPECTED RED]', async () => {
  const after = new Date(CLOCK + 90_000).toUTCString()
  const { fetcher, sleeps, calls } = setup(after)
  assert.equal((await fetcher.request(URL)).status, 200)
  assert.equal(calls.length, 2)
  assert.deepEqual(sleeps, [90_000])
})

test('far-future HTTP-date cooldown respects existing bounded 120s cap [EXPECTED RED]', async () => {
  const after = new Date(CLOCK + 360_000).toUTCString()
  const { fetcher, sleeps, calls } = setup(after)
  assert.equal((await fetcher.request(URL)).status, 200)
  assert.equal(calls.length, 2)
  assert.deepEqual(sleeps, [120_000])
})

test('numeric 11-second Retry-After remains valid', async () => {
  const { fetcher, sleeps } = setup('11')
  assert.equal((await fetcher.request(URL)).status, 200)
  assert.deepEqual(sleeps, [11_000])
})
test('malformed Retry-After continues the conservative 30-second fallback', async () => {
  const { fetcher, sleeps } = setup('invalid http date')
  assert.equal((await fetcher.request(URL)).status, 200)
  assert.deepEqual(sleeps, [30_000])
})
test('missing Retry-After still uses the repaired 30-second fallback', async () => {
  const { fetcher, sleeps } = setup(null)
  assert.equal((await fetcher.request(URL)).status, 200)
  assert.deepEqual(sleeps, [30_000])
})
