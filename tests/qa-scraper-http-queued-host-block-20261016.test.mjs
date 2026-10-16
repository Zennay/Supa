import test from 'node:test'
import assert from 'node:assert/strict'

import { HostBlockedError, PoliteFetcher } from '../scraper/lib/http.mjs'

// The transport is entirely fake: no DNS, network, retailer requests or
// permission claims. The concurrency schedule is controlled by a promise
// instead of wall-clock delays, so CI can reproduce the race deterministically.
const HOST = 'shop.example.test'
const FIRST = `https://${HOST}/fictional/first`
const SECOND = `https://${HOST}/fictional/second`
const OTHER = 'https://other.example.test/fictional/ok'

function reply(url, status) {
  const bytes = new TextEncoder().encode('<html>fictional response</html>')
  return {
    url, status, ok: status >= 200 && status < 300,
    headers: { get: () => null },
    body: { async cancel() {} },
    async arrayBuffer() { return bytes.buffer },
  }
}

function barrier() {
  let release
  const promise = new Promise((resolve) => { release = resolve })
  return { promise, release: () => release() }
}

function client(fetchImpl) {
  return new PoliteFetcher({
    fetchImpl, minDelayMs: 0, retries: 0,
    respectRobots: false, sleepImpl: async () => {},
  })
}

for (const status of [401, 403]) {
  test(`a pending same-host HTTP request is never transported after earlier HTTP ${status} host block [EXPECTED RED]`, async () => {
    const gate = barrier()
    const firstStarted = barrier()
    const calls = []
    const f = client(async (url, options) => {
      assert.equal(options.redirect, 'manual')
      calls.push(url)
      if (url === FIRST) {
        firstStarted.release()
        await gate.promise
        return reply(url, status)
      }
      return reply(url, 200)
    })

    const first = f.request(FIRST)
    await firstStarted.promise
    // The first HTTP request has started; enqueue a second on the exact same
    // host before releasing its 401/403. That second request must be denied.
    const second = f.request(SECOND)
    const secondResult = second.then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    gate.release()
    await assert.rejects(first, (error) => error instanceof HostBlockedError)
    const outcome = await secondResult
    assert.ok(outcome.error instanceof HostBlockedError,
      'queued request must reject with HostBlockedError rather than fetch another article')
    assert.deepEqual(calls, [FIRST],
      'the queued same-host URL must not be passed to injected fetchImpl')
    assert.match(f.isBlocked(HOST), /HTTP (401|403)/)
  })
}

test('a blocked host prevents later requests created after the 403 response', async () => {
  const calls = []
  const f = client(async (url) => {
    calls.push(url)
    return reply(url, 403)
  })
  await assert.rejects(f.request(FIRST), HostBlockedError)
  await assert.rejects(f.request(SECOND), HostBlockedError)
  assert.deepEqual(calls, [FIRST])
  assert.match(f.isBlocked(HOST), /403/)
})

test('two concurrent successful same-host articles remain supported', async () => {
  const calls = []
  const f = client(async (url) => {
    calls.push(url)
    return reply(url, 200)
  })
  const [a, b] = await Promise.all([f.request(FIRST), f.request(SECOND)])
  assert.equal(a.url, FIRST)
  assert.equal(b.url, SECOND)
  assert.deepEqual(calls, [FIRST, SECOND])
})

test('a blocked retailer must not block unrelated approved fictional HTTPS host', async () => {
  const calls = []
  const f = client(async (url) => {
    calls.push(url)
    return reply(url, url === FIRST ? 403 : 200)
  })
  await assert.rejects(f.request(FIRST), HostBlockedError)
  assert.equal((await f.request(OTHER)).url, OTHER)
  assert.deepEqual(calls, [FIRST, OTHER])
})
