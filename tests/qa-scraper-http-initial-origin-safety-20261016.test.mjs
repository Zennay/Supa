import test from 'node:test'
import assert from 'node:assert/strict'

import { PoliteFetcher } from '../scraper/lib/http.mjs'

// All URLs are synthetic local strings. fetchImpl is an injected spy; no DNS,
// socket, live retailer, source permission, credential or production traffic.
function probe(initialUrl) {
  const calls = []
  const bytes = Uint8Array.from(Buffer.from('<html>fictional test</html>'))
  const fetcher = new PoliteFetcher({
    respectRobots: false,
    retries: 0,
    minDelayMs: 0,
    sleepImpl: async () => {},
    fetchImpl: async (url, options) => {
      calls.push({ url, redirect: options.redirect })
      return {
        url,
        status: 200,
        ok: true,
        headers: { get: () => null },
        body: { async cancel() {} },
        async arrayBuffer() { return bytes.buffer },
      }
    },
  })
  return { request: () => fetcher.request(initialUrl), calls }
}

test('ordinary initial HTTPS retailer hostname remains an allowed fake request', async () => {
  const url = 'https://shop.example.test/catalog/item'
  const q = probe(url)
  assert.equal((await q.request()).url, url)
  assert.deepEqual(q.calls, [{ url, redirect: 'manual' }])
})

test('canonical HTTPS :443 is not treated as a non-standard port', async () => {
  const q = probe('https://shop.example.test:443/catalog/item')
  assert.equal((await q.request()).url, 'https://shop.example.test/catalog/item')
  assert.equal(q.calls.length, 1)
})

for (const [description, initialUrl] of [
  ['IPv4 loopback', 'https://127.0.0.1/private'],
  ['IPv6 loopback', 'https://[::1]/private'],
  ['RFC1918 private IPv4', 'https://10.0.0.8/private'],
  ['cloud metadata link-local IPv4', 'https://169.254.169.254/latest/meta-data/'],
  ['numeric IP normalization trick', 'https://2130706433/private'],
  ['localhost hostname', 'https://localhost/private'],
  ['subdomain of localhost', 'https://anything.localhost/private'],
  ['nonstandard HTTPS port on apparently valid shop', 'https://shop.example.test:444/catalog/item'],
]) {
  test('initial retailer HTTP origin cannot send first request to ' + description + ' [EXPECTED RED]', async () => {
    const q = probe(initialUrl)
    await assert.rejects(q.request(), /approved HTTPS origin|unsafe retailer target|retailer HTTP/i)
    assert.deepEqual(q.calls, [], 'no first request may be sent to an ineligible initial origin')
  })
}

for (const [description, initialUrl] of [
  ['HTTP downgrade', 'http://shop.example.test/catalog/item'],
  ['embedded username', 'https://user@shop.example.test/catalog/item'],
  ['embedded password', 'https://user:secret@shop.example.test/catalog/item'],
]) {
  test('known invalid initial origin still stops before fake transport: ' + description, async () => {
    const q = probe(initialUrl)
    await assert.rejects(q.request(), /approved HTTPS origin|retailer HTTP/)
    assert.deepEqual(q.calls, [])
  })
}
