import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_PROXY_FEED,
  isPublicIPv4,
  parseProxyCandidates,
  downloadProxyCandidates,
  ProxyHealthPool,
} from '../scripts/retailer-proxy-pool.mjs'

test('candidate list accepts only public IPv4 proxies and deduplicates', () => {
  const input = [
    '8.8.8.8:8080', '8.8.8.8:8080', '1.1.1.1:3128',
    '127.0.0.1:1234', '10.0.0.1:443', '192.168.1.1:80',
    '169.254.169.254:80', '172.17.0.1:80', '100.64.0.1:80',
    '192.0.2.1:80', '198.51.100.1:80', '203.0.113.1:80',
    '8.8.8.8:0', '8.8.8.8:65536', 'example.org:80',
    'user:pass@8.8.8.8:80', 'http://8.8.8.8:8080',
  ].join('\n')
  assert.deepEqual(parseProxyCandidates(input), [
    'http://8.8.8.8:8080', 'http://1.1.1.1:3128',
  ])
  assert.equal(isPublicIPv4('8.8.8.8'), true)
  assert.equal(isPublicIPv4('127.0.0.1'), false)
  assert.equal(isPublicIPv4('::1'), false)
})

test('bounded input and candidate counts never silently overflow', () => {
  assert.throws(() => parseProxyCandidates('x'.repeat(512_001)), /bounded/)
  assert.throws(() => parseProxyCandidates('', 0), /limit/)
  assert.throws(() => parseProxyCandidates('', 1025), /limit/)
  assert.deepEqual(parseProxyCandidates('8.8.8.8:80\n9.9.9.9:80', 1), [
    'http://8.8.8.8:80',
  ])
})

test('download fetches only the pinned provider via direct HTTPS and refuses redirects', async () => {
  const result = await downloadProxyCandidates(async (url, options) => {
    assert.equal(url, DEFAULT_PROXY_FEED)
    assert.equal(options.redirect, 'error')
    assert.equal(new URL(url).protocol, 'https:')
    return {
      ok: true,
      url,
      headers: { get: () => '13' },
      text: async () => '8.8.8.8:8080',
    }
  })
  assert.deepEqual(result, ['http://8.8.8.8:8080'])
  await assert.rejects(
    downloadProxyCandidates(async () => ({
      ok: true,
      url: 'https://attacker.example/candidates',
      headers: { get: () => '4' },
      text: async () => 'test',
    })),
    /redirect/,
  )
  await assert.rejects(
    downloadProxyCandidates(async () => ({ ok: false })),
    /unavailable/,
  )
})

test('new candidates cannot be selected without an own-endpoint healthcheck', () => {
  const pool = new ProxyHealthPool()
  assert.equal(pool.needsRefresh(0), true)
  assert.equal(pool.refresh(['http://8.8.8.8:8080'], 0), 1)
  assert.equal(pool.select(0), null)
  assert.deepEqual(pool.dueForProbe(0), ['http://8.8.8.8:8080'])
  assert.equal(pool.recordProbe('http://8.8.8.8:8080', {
    ok: true, latencyMs: 10, ownedEndpoint: false,
  }, 100), false)
  assert.equal(pool.select(100), null)
  assert.deepEqual(pool.dueForProbe(100), [])
})

test('trusted health result allows temporary selection, then expires', () => {
  const pool = new ProxyHealthPool({ healthyTtlMs: 1000 })
  pool.refresh(['http://8.8.8.8:80'], 100)
  assert.equal(pool.recordProbe('http://8.8.8.8:80', {
    ok: true, ownedEndpoint: true, latencyMs: 70,
  }, 200), true)
  assert.equal(pool.select(1199), 'http://8.8.8.8:80')
  assert.equal(pool.select(1200), null)
  assert.deepEqual(pool.dueForProbe(1200), ['http://8.8.8.8:80'])
})

test('failed health check quarantines proxy with exponential cooldown', () => {
  const pool = new ProxyHealthPool({ cooldownMs: 100 })
  pool.refresh(['http://8.8.8.8:80'], 0)
  assert.equal(pool.recordProbe('http://8.8.8.8:80', {
    ok: false, ownedEndpoint: true, latencyMs: 30,
  }, 0), false)
  assert.deepEqual(pool.dueForProbe(99), [])
  assert.equal(pool.recordProbe('http://8.8.8.8:80', {
    ok: true, ownedEndpoint: true, latencyMs: 20,
  }, 99), false)
  assert.equal(pool.recordProbe('http://8.8.8.8:80', {
    ok: false, ownedEndpoint: true, latencyMs: 20,
  }, 100), false)
  assert.deepEqual(pool.dueForProbe(299), [])
  assert.deepEqual(pool.dueForProbe(300), ['http://8.8.8.8:80'])
})

test('removing candidates or losing source freshness fails closed', () => {
  const pool = new ProxyHealthPool({
    refreshIntervalMs: 1000,
    healthyTtlMs: 10_000,
  })
  pool.refresh(['http://8.8.8.8:80', 'http://1.1.1.1:80'], 0)
  pool.recordProbe('http://8.8.8.8:80', {
    ok: true, ownedEndpoint: true, latencyMs: 20,
  }, 100)
  pool.recordProbe('http://1.1.1.1:80', {
    ok: true, ownedEndpoint: true, latencyMs: 10,
  }, 100)
  assert.equal(pool.select(100), 'http://1.1.1.1:80')
  pool.refresh(['http://8.8.8.8:80'], 200)
  assert.equal(pool.select(200), 'http://8.8.8.8:80')
  assert.equal(pool.select(2200), null)
  assert.equal(pool.needsRefresh(1200), true)
  pool.refresh([], 2300)
  assert.equal(pool.select(2300), null)
  assert.deepEqual(pool.summary(2300), {
    candidates: 0,
    healthy: 0,
    needingProbe: 0,
    lastRefreshAt: 2300,
  })
})

test('invalid candidate and health inputs fail closed', () => {
  const pool = new ProxyHealthPool()
  assert.throws(() => pool.refresh('text', 0), /collection/)
  assert.throws(() => pool.refresh([], -1), /Timestamp/)
  assert.throws(() => pool.recordProbe('http://9.9.9.9:80', {}, 0), /Unknown/)
  pool.refresh(['http://127.0.0.1:80', 'http://8.8.8.8:443'], 0)
  assert.equal(pool.summary(0).candidates, 1)
  assert.equal(pool.recordProbe('http://8.8.8.8:443', {
    ok: true, ownedEndpoint: true, latencyMs: 999_999,
  }, 0), false)
  assert.equal(pool.select(0), null)
})
