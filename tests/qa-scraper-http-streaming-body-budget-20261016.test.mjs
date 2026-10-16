import test from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { PoliteFetcher } from '../scraper/lib/http.mjs'

// Entire HTTP transport is injected; streams and hosts are fictional. No DNS,
// sockets, retailer requests, permissions, real prices or production I/O.
const URL = 'https://shop.example.test/catalog/fictional'
const LIMIT = 128
function setup(chunks) {
  const state = { produced: 0, cancelled: false, requests: 0 }
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(chunks[state.produced++]))
      if (state.produced === chunks.length) controller.close()
    },
    cancel() { state.cancelled = true },
  }, { highWaterMark: 0 })
  const reply = new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
  const fetcher = new PoliteFetcher({
    maxBytes: LIMIT, respectRobots: false, retries: 0,
    minDelayMs: 0, sleepImpl: async () => {},
    fetchImpl: async (url, options) => {
      state.requests++
      assert.equal(url, URL)
      assert.equal(options.redirect, 'manual')
      return reply
    },
  })
  return { fetcher, state }
}
test('128 wire bytes from real WHATWG response stream are permitted', async () => {
  const { fetcher, state } = setup([Buffer.alloc(64, 'a'), Buffer.alloc(64, 'b')])
  assert.equal((await fetcher.request(URL)).text, 'a'.repeat(64) + 'b'.repeat(64))
  assert.deepEqual([state.produced, state.requests, state.cancelled], [2, 1, false])
})
test('split streamed gzip under wire and decompressed budget remains accepted', async () => {
  const text = '<html>fictional source</html>'
  const zip = gzipSync(Buffer.from(text))
  assert.ok(zip.length < LIMIT)
  const n = Math.floor(zip.length / 2)
  const { fetcher, state } = setup([zip.subarray(0, n), zip.subarray(n)])
  assert.equal((await fetcher.request(URL)).text, text)
  assert.equal(state.requests, 1)
})
test('streamed HTML over limit stops reading after boundary breach [EXPECTED RED]', async () => {
  const { fetcher, state } = setup(Array.from({ length: 12 }, () => Buffer.alloc(64, 'a')))
  await assert.rejects(fetcher.request(URL), /exceeds maximum bytes/i)
  assert.equal(state.requests, 1)
  assert.ok(state.produced <= 3, 'overlong body must not be fully buffered before refusal')
})
test('streamed over-limit body must cancel remaining response input [EXPECTED RED]', async () => {
  const { fetcher, state } = setup(Array.from({ length: 12 }, () => Buffer.alloc(64, 'a')))
  await assert.rejects(fetcher.request(URL), /exceeds maximum bytes/i)
  assert.equal(state.requests, 1)
  assert.ok(state.cancelled, 'source stream must be cancelled on byte cap')
})
test('streamed multibyte UTF-8 is bounded in bytes, not JS chars [EXPECTED RED]', async () => {
  const { fetcher, state } = setup(Array.from({ length: 9 }, () => Buffer.from('é'.repeat(32))))
  await assert.rejects(fetcher.request(URL), /exceeds maximum bytes/i)
  assert.equal(state.requests, 1)
  assert.ok(state.produced <= 3, 'multibyte bytes must stop at the same cap')
})
