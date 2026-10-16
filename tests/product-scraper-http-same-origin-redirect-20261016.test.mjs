import test from 'node:test'
import assert from 'node:assert/strict'

import { PoliteFetcher } from '../scraper/lib/http.mjs'

// Entire transport is a synthetic function. Not a single outgoing network
// request, source permission, real retailer identity, or production activation.
const base = 'https://shop.example.test/catalog/item'
function reply(status, url, location = null) {
  const bytes = new TextEncoder().encode('<html>fictional response</html>')
  return {
    status,
    url,
    ok: status >= 200 && status < 300,
    headers: { get(name) {
      if (name.toLowerCase() === 'location') return location
      if (name.toLowerCase() === 'content-type') return 'text/html'
      return null
    } },
    body: { async cancel() {} },
    async arrayBuffer() { return bytes.buffer },
  }
}

function client(fetchImpl) {
  return new PoliteFetcher({
    fetchImpl, respectRobots: false, retries: 0,
    minDelayMs: 0, sleepImpl: async () => {},
  })
}

test('clean HTTPS article without redirect uses only one fake request', async () => {
  const requested = []
  const f = client(async (url, options) => {
    requested.push({ url, redirect: options.redirect })
    return reply(200, url)
  })
  const result = await f.request(base)
  assert.equal(result.url, base)
  assert.equal(result.status, 200)
  assert.deepEqual(requested, [{ url: base, redirect: 'manual' }])
})

test('same HTTPS host path redirect succeeds and remains inside finite bounded fake transport', async () => {
  const requested = []
  const f = client(async (url, opts) => {
    requested.push({ url, redirect: opts.redirect })
    return requested.length === 1
      ? reply(302, url, '/catalog/renamed')
      : reply(200, url)
  })
  const result = await f.request(base)
  assert.equal(result.url, 'https://shop.example.test/catalog/renamed')
  assert.deepEqual(requested.map(x => x.url), [base, result.url])
  assert.ok(requested.every(x => x.redirect === 'manual'))
  assert.equal(f.stats.requests, 2)
})

for (const [description, to] of [
  ['foreign HTTPS host', 'https://foreign.example.test/new'],
  ['suffix-spoof host', 'https://shop.example.test.attack.invalid/new'],
  ['HTTP downgrade', 'http://shop.example.test/new'],
  ['embedded username authority spoof', 'https://shop.example.test@foreign.example.test/new'],
  ['non-standard port', 'https://shop.example.test:444/new'],
  ['IP literal', 'https://127.0.0.1/new'],
]) {
  test('disallowed redirect never starts a second request: ' + description, async () => {
    const requested = []
    const f = client(async (url, opts) => {
      requested.push({ url, redirect: opts.redirect })
      return reply(302, url, to)
    })
    await assert.rejects(f.request(base), /redirect target is not an approved HTTPS origin/)
    assert.deepEqual(requested.map(x => x.url), [base])
    assert.equal(requested[0].redirect, 'manual')
  })
}

test('redirect loop fails closed and never asks for a third fictitious response', async () => {
  const requested = []
  const f = client(async url => {
    requested.push(url)
    return reply(301, url, url === base ? '/again' : base)
  })
  await assert.rejects(f.request(base), /redirect loop/)
  assert.deepEqual(requested, [base, 'https://shop.example.test/again'])
})

test('unsafe method cannot replay request body through a redirect', async () => {
  const requested = []
  const f = client(async url => {
    requested.push(url)
    return reply(307, url, '/other')
  })
  await assert.rejects(f.request(base, { method: 'POST', body: 'fictional' }), /redirect refused/)
  assert.deepEqual(requested, [base])
})

test('no location header fails closed before another request', async () => {
  let requests = 0
  const f = client(async url => { requests += 1; return reply(302, url) })
  await assert.rejects(f.request(base), /redirect refused/)
  assert.equal(requests, 1)
})

test('injected mock that violates manual redirects is still rejected at response origin', async () => {
  const requested = []
  const f = client(async url => {
    requested.push(url)
    return reply(200, 'https://foreign.example.test/final')
  })
  await assert.rejects(f.request(base), /outside approved HTTPS origin/)
  assert.deepEqual(requested, [base])
})
