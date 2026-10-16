import test from 'node:test'
import assert from 'node:assert/strict'

import { HostBlockedError, PoliteFetcher } from '../scraper/lib/http.mjs'

// Fully injected fictional HTTP transport: zero DNS, network, retailer data,
// canonical rights changes, live price observation or production requests.
const URL = 'https://shop.example.test/catalog/fictional'
const WAIT_FALLBACK_MS = 30_000

function response(status, retryAfter = null) {
  const bytes = Uint8Array.from(Buffer.from('fictional response'))
  return {
    status,
    ok: status >= 200 && status < 300,
    url: URL,
    headers: { get: (key) => key.toLowerCase() === 'retry-after' ? retryAfter : null },
    body: { async cancel() {} },
    async arrayBuffer() { return bytes.buffer },
  }
}

function setup(replies) {
  let requests = 0
  const sleeps = []
  const fetcher = new PoliteFetcher({
    respectRobots: false,
    retries: 0,
    minDelayMs: 0,
    sleepImpl: async (ms) => { sleeps.push(ms) },
    fetchImpl: async (url, options) => {
      assert.equal(url, URL)
      assert.equal(options.redirect, 'manual')
      return replies[Math.min(requests++, replies.length - 1)]
    },
  })
  return { fetcher, sleeps, requests: () => requests }
}

test('429 with missing Retry-After must honor conservative fallback delay [EXPECTED RED]', async () => {
  const { fetcher, sleeps, requests } = setup([response(429), response(200)])
  const res = await fetcher.request(URL)
  assert.equal(res.status, 200)
  assert.equal(requests(), 2)
  assert.deepEqual(sleeps, [WAIT_FALLBACK_MS])
})

test('429 with negative Retry-After must not schedule a negative cooldown [EXPECTED RED]', async () => {
  const { fetcher, sleeps, requests } = setup([response(429, '-5'), response(200)])
  const res = await fetcher.request(URL)
  assert.equal(res.status, 200)
  assert.equal(requests(), 2)
  assert.deepEqual(sleeps, [WAIT_FALLBACK_MS])
})

test('429 with explicit positive Retry-After seconds preserves server-requested wait', async () => {
  const { fetcher, sleeps, requests } = setup([response(429, '7'), response(200)])
  assert.equal((await fetcher.request(URL)).status, 200)
  assert.equal(requests(), 2)
  assert.deepEqual(sleeps, [7_000])
})

test('429 with malformed nonnumeric Retry-After already uses fallback', async () => {
  const { fetcher, sleeps, requests } = setup([response(429, 'not-seconds'), response(200)])
  assert.equal((await fetcher.request(URL)).status, 200)
  assert.equal(requests(), 2)
  assert.deepEqual(sleeps, [WAIT_FALLBACK_MS])
})

test('clean fictional HTTP 200 never adds a 429 cooldown', async () => {
  const { fetcher, sleeps, requests } = setup([response(200)])
  assert.equal((await fetcher.request(URL)).status, 200)
  assert.equal(requests(), 1)
  assert.deepEqual(sleeps, [])
})

test('three consecutive 429 responses block host rather than retry indefinitely', async () => {
  const { fetcher, sleeps, requests } = setup([response(429, '1')])
  await assert.rejects(fetcher.request(URL), (err) => {
    assert.ok(err instanceof HostBlockedError)
    assert.match(err.reason, /rate limited/)
    return true
  })
  assert.equal(requests(), 3)
  assert.deepEqual(sleeps, [1000, 1000])
})
