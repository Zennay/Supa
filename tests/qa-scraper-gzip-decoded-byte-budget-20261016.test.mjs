import test from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'

import { PoliteFetcher } from '../scraper/lib/http.mjs'

// QA-only, wholly synthetic injected transport: no DNS, actual retailer,
// outgoing HTTP, source-rights grant, consumer price or crawl permission.
const URL = 'https://shop.example.test/catalog/fictional-item'
const MAX_BYTES = 128

function fakeReply(bytes) {
  const payload = Uint8Array.from(bytes)
  return {
    url: URL,
    status: 200,
    ok: true,
    headers: { get: (key) => key.toLowerCase() === 'content-type' ? 'text/html' : null },
    body: { async cancel() {} },
    async arrayBuffer() { return payload.buffer },
  }
}

function client(bytes) {
  let requests = 0
  const fetcher = new PoliteFetcher({
    maxBytes: MAX_BYTES,
    minDelayMs: 0,
    retries: 0,
    respectRobots: false,
    sleepImpl: async () => {},
    fetchImpl: async (url, options) => {
      requests += 1
      assert.equal(url, URL)
      assert.equal(options.redirect, 'manual')
      return fakeReply(bytes)
    },
  })
  return { fetcher, requests: () => requests }
}

test('plain fictional response within byte budget remains accepted', async () => {
  const text = '<html>safe fictional source</html>'
  const { fetcher, requests } = client(Buffer.from(text, 'utf8'))
  assert.equal((await fetcher.request(URL)).text, text)
  assert.equal(requests(), 1)
})

test('gzip response within both transmitted and decoded budgets remains accepted', async () => {
  const text = '<html>short fictional source</html>'
  const compressed = gzipSync(Buffer.from(text, 'utf8'))
  assert.ok(compressed.length <= MAX_BYTES)
  const { fetcher, requests } = client(compressed)
  assert.equal((await fetcher.request(URL)).text, text)
  assert.equal(requests(), 1)
})

test('uncompressed response larger than configured maxBytes is rejected', async () => {
  const { fetcher, requests } = client(Buffer.alloc(MAX_BYTES + 1, 0x41))
  await assert.rejects(fetcher.request(URL), /exceeds maximum bytes/i)
  assert.equal(requests(), 1)
})

test('gzip tiny on the wire but huge after inflate must fail closed before returning text [EXPECTED RED]', async () => {
  const decoded = Buffer.from('A'.repeat(10_000), 'utf8')
  const compressed = gzipSync(decoded)
  assert.ok(compressed.length < MAX_BYTES, 'fixture needs to pass compressed-byte budget')
  assert.ok(decoded.length > MAX_BYTES, 'fixture needs to exceed decoded-byte budget')
  const { fetcher, requests } = client(compressed)
  await assert.rejects(fetcher.request(URL), /exceeds maximum bytes/i)
  assert.equal(requests(), 1)
})

test('decoded UTF-8 multibyte payload is counted in bytes, not JS characters [EXPECTED RED]', async () => {
  const decoded = Buffer.from('é'.repeat(1_500), 'utf8')
  const compressed = gzipSync(decoded)
  assert.ok(compressed.length < MAX_BYTES)
  assert.ok(decoded.length > MAX_BYTES)
  const { fetcher, requests } = client(compressed)
  await assert.rejects(fetcher.request(URL), /exceeds maximum bytes/i)
  assert.equal(requests(), 1)
})

test('malformed gzip archive remains rejected without trusting partially decoded content', async () => {
  const compressed = gzipSync(Buffer.from('fictional', 'utf8')).subarray(0, 13)
  const { fetcher, requests } = client(compressed)
  await assert.rejects(fetcher.request(URL))
  assert.equal(requests(), 1)
})
