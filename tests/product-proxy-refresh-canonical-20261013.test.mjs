import test from 'node:test'
import assert from 'node:assert/strict'
import { ProxyHealthPool, parseProxyCandidates } from '../scripts/retailer-proxy-pool.mjs'

test('feed parser remains permissive on mixed offline rows, without authorizing candidates', () => {
  assert.deepEqual(parseProxyCandidates('8.8.8.8:80\nerror\n10.0.0.1:80\n'),
    ['http://8.8.8.8:80'])
})
test('canonical single-endpoint refresh refuses recoded ports, extra rows and whitespace', () => {
  const valid = 'http://8.8.8.8:80'
  for (const candidate of [
    valid + '\ninvalid', valid + '\n10.0.0.7:80',
    valid + '\r\n8.8.8.8:80', valid + '\u0000',
    valid + ' ', valid + '\t', valid + '\r', valid + '\n',
    'http://8.8.8.8:080', 'http://8.8.8.8:00080',
    'http:// 8.8.8.8:80', 'http://8.8.8.8:80#fragment',
  ]) {
    const pool = new ProxyHealthPool()
    assert.equal(pool.refresh([candidate], 0), 0, JSON.stringify(candidate))
    assert.deepEqual(pool.dueForProbe(0), [])
    assert.equal(pool.select(0), null)
    assert.throws(() => pool.recordProbe(candidate, {
      ownedEndpoint: true, ok: true, latencyMs: 1,
    }, 0), /Unknown proxy/)
    assert.equal(pool.summary(0).healthy, 0)
  }
})
test('exactly one valid canonical endpoint remains gated by authorized echo and TTL', () => {
  const endpoint = 'http://8.8.8.8:80'
  const pool = new ProxyHealthPool({ healthyTtlMs: 1000 })
  assert.equal(pool.refresh([endpoint, endpoint], 0), 1)
  assert.equal(pool.select(0), null)
  assert.equal(pool.recordProbe(endpoint, {
    ownedEndpoint: true, ok: true, latencyMs: 5,
  }, 10), true)
  assert.equal(pool.select(10), endpoint)
  assert.equal(pool.select(1010), null)
})
