import assert from 'node:assert/strict'
import test from 'node:test'

import { ProxyHealthPool, parseProxyCandidates } from '../scripts/retailer-proxy-pool.mjs'

// All addresses here are inert literals; no requests are made, and these tests
// do not certify any retailer permission or any third-party proxy's safety.
const A = 'http://8.8.8.8:8080'
const B = 'http://1.1.1.1:3128'
const C = 'http://9.9.9.9:8080'
const healthy = (latencyMs) => ({ ok: true, ownedEndpoint: true, latencyMs })

test('QA: fastest fresh positive OWN-endpoint result wins, then expires at exact boundary', () => {
  const pool = new ProxyHealthPool({
    refreshIntervalMs: 1000, healthyTtlMs: 1000, cooldownMs: 100,
  })
  assert.equal(pool.refresh([A, B], 0), 2)
  assert.deepEqual(pool.healthy(0), [])
  assert.equal(pool.select(0), null)
  assert.equal(pool.recordProbe(A, healthy(80), 100), true)
  assert.equal(pool.select(109), A)
  assert.equal(pool.recordProbe(B, healthy(10), 110), true)
  assert.deepEqual(pool.healthy(110), [B, A])
  assert.equal(pool.select(110), B)
  assert.equal(pool.select(1099), B)
  assert.deepEqual(pool.healthy(1100), [B], 'A expires at exactly age 1000ms')
  assert.equal(pool.select(1110), null, 'B expires at its own exact TTL')
  assert.deepEqual(pool.dueForProbe(1110), [A, B])
  assert.equal(pool.needsRefresh(1000), true)
  assert.equal(pool.select(2000), null, 'stale feed never authorizes a fallback')
})

test('QA: exponential backoff rejects early success and never selects quarantined proxy', () => {
  const pool = new ProxyHealthPool({ cooldownMs: 100, healthyTtlMs: 1000 })
  pool.refresh([A], 0)
  let now = 0
  for (let failure = 1; failure <= 8; failure += 1) {
    assert.equal(pool.recordProbe(A, { ownedEndpoint: true, ok: false, latencyMs: 5 }, now), false)
    assert.equal(pool.select(now), null)
    const wait = 100 * (2 ** Math.min(failure - 1, 6))
    assert.deepEqual(pool.dueForProbe(now + wait - 1), [])
    assert.equal(pool.recordProbe(A, healthy(1), now + wait - 1), false)
    assert.deepEqual(pool.dueForProbe(now + wait), [A])
    now += wait
  }
  assert.equal(pool.recordProbe(A, healthy(100), now), true)
  assert.equal(pool.select(now), A)
  assert.equal(pool.summary(now).needingProbe, 0)
})

test('QA: remove and readd a previously verified address loses old proof', () => {
  const pool = new ProxyHealthPool({ refreshIntervalMs: 500, healthyTtlMs: 1000 })
  pool.refresh([A, B], 0)
  pool.recordProbe(A, healthy(30), 10)
  assert.equal(pool.select(10), A)
  assert.equal(pool.refresh([B], 100), 1)
  assert.equal(pool.select(100), null)
  assert.equal(pool.refresh([B, A], 200), 2)
  assert.equal(pool.select(200), null, 'reintroduction must not inherit removed health')
  assert.ok(pool.dueForProbe(200).includes(A))
  assert.equal(pool.recordProbe(A, healthy(30), 201), true)
  assert.equal(pool.select(201), A)
  assert.equal(pool.refresh([], 202), 0)
  assert.deepEqual(pool.healthy(202), [])
})

test('QA: candidate churn, dedup and protocol denial stay fail-closed offline', () => {
  const pool = new ProxyHealthPool({
    refreshIntervalMs: 500, healthyTtlMs: 125, cooldownMs: 10, maxLatencyMs: 25,
  })
  const order = [A, B, C]
  for (let tick = 0; tick < 100; tick += 1) {
    const now = tick * 500
    const allowed = [order[tick % 3], order[(tick + 1) % 3]]
    assert.equal(pool.refresh([allowed[0], allowed[0], allowed[1]], now), 2)
    assert.equal(pool.select(now), null,
      'rotating previously removed entries may not reuse an old verification')
    assert.equal(pool.recordProbe(allowed[0], { ok: true, ownedEndpoint: false, latencyMs: 0 }, now), false)
    assert.equal(pool.select(now), null, 'fake retailer result cannot authorize a proxy')
    assert.equal(pool.recordProbe(allowed[1], healthy(15), now), true)
    assert.equal(pool.select(now), allowed[1])
    assert.equal(pool.select(now + 125), null)
    assert.equal(pool.select(now + 1000), null)
    assert.ok(pool.healthy(now).every((endpoint) => allowed.includes(endpoint)))
  }
  assert.deepEqual(parseProxyCandidates('8.8.8.8:8080\n8.8.8.8:8080\n10.0.0.1:80'), [A])
})
