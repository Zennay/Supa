import test from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { PoliteFetcher } from '../scraper/lib/http.mjs'

// Product-owner regressions beside the immutable independent QA replays.
// All URLs and streams are synthetic; fetchImpl performs no network I/O.
const URL = 'https://shop.example.test/catalog/fictional'
const NOW = Date.parse('2026-10-16T12:00:00Z')

function dateRetry(header) {
  const waits = []
  let n = 0
  const fetcher = new PoliteFetcher({
    respectRobots: false, retries: 0, minDelayMs: 0,
    now: () => NOW,
    sleepImpl: async (ms) => { waits.push(ms) },
    fetchImpl: async () => {
      n++
      const status = n === 1 ? 429 : 200
      return {
        url: URL, status, ok: status === 200,
        headers: { get: (name) => name === 'retry-after' ? header : null },
        body: { async cancel() {} },
        async arrayBuffer() { return Uint8Array.of(111, 107).buffer },
      }
    },
  })
  return { fetcher, waits, get requests() { return n } }
}

test('stale HTTP-date cannot shorten the conservative retry fallback', async () => {
  const mocked = dateRetry(new Date(NOW - 60_000).toUTCString())
  assert.equal((await mocked.fetcher.request(URL)).text, 'ok')
  assert.deepEqual(mocked.waits, [30_000])
  assert.equal(mocked.requests, 2)
})

test('wrong HTTP weekday is not accepted as an absolute retry deadline', async () => {
  const future = new Date(NOW + 90_000).toUTCString()
  const otherDay = future.replace(/^[A-Z][a-z]{2}/, future.startsWith('Fri') ? 'Mon' : 'Fri')
  const mocked = dateRetry(otherDay)
  assert.equal((await mocked.fetcher.request(URL)).text, 'ok')
  assert.deepEqual(mocked.waits, [30_000])
})

test('numeric zero delay remains permitted rather than replaced with fallback', async () => {
  const mocked = dateRetry('0')
  assert.equal((await mocked.fetcher.request(URL)).text, 'ok')
  assert.deepEqual(mocked.waits, [])
  // A zero cooldown has no sleep; both requests still occur with circuit guard intact.
  assert.equal(mocked.requests, 2)
})

function streamReply(payload, maxBytes) {
  const state = { cancelled: false }
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(payload)) },
    cancel() { state.cancelled = true },
  }, { highWaterMark: 0 })
  const fetcher = new PoliteFetcher({
    maxBytes, respectRobots: false, retries: 0, minDelayMs: 0,
    fetchImpl: async () => new Response(stream, { status: 200 }),
  })
  return { fetcher, state }
}

test('gzip under the raw wire budget still cannot exceed decoded budget', async () => {
  const gzip = gzipSync(Buffer.from('A'.repeat(2000)))
  assert.ok(gzip.length < 128)
  const { fetcher } = streamReply(gzip, 128)
  await assert.rejects(fetcher.request(URL), /decoded response exceeds maximum bytes/i)
})

test('exact one-chunk raw wire limit succeeds', async () => {
  const { fetcher, state } = streamReply(Buffer.from('x'.repeat(128)), 128)
  assert.equal((await fetcher.request(URL)).text, 'x'.repeat(128))
  assert.equal(state.cancelled, false)
})

test('first raw chunk above budget is refused and cancelled immediately', async () => {
  const { fetcher, state } = streamReply(Buffer.alloc(129, 120), 128)
  await assert.rejects(fetcher.request(URL), /response exceeds maximum bytes/i)
  assert.equal(state.cancelled, true)
})
