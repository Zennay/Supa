import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseProxyCandidates,
  ProxyHealthPool,
} from '../scripts/retailer-proxy-pool.mjs'

const VALID = 'http://8.8.8.8:8080'
const ECHO = { ownedEndpoint: true, ok: true, latencyMs: 9 }

test('positive: feed parser can ignore extraneous rows without authorizing them', () => {
  const feed = '8.8.8.8:8080\nnot-an-endpoint\n10.0.0.1:80\n8.8.8.8:8080\n'
  assert.deepEqual(parseProxyCandidates(feed), [VALID])
})

test('positive: exact canonical candidate requires an owned-HTTPS-echo health result', () => {
  const pool = new ProxyHealthPool()
  assert.equal(pool.refresh([VALID], 100), 1)
  assert.equal(pool.select(100), null, 'new inventory is not a healthy proxy')
  assert.equal(pool.recordProbe(VALID, { ...ECHO, ownedEndpoint: false }, 110), false)
  assert.equal(pool.select(110), null)
  assert.equal(pool.recordProbe(VALID, ECHO, 300_111), true)
  assert.equal(pool.select(300_111), VALID)
})

test('EXPECTED RED: a single candidate containing an extra invalid line never enters health state', () => {
  for (const raw of [
    VALID + '\nnot-an-endpoint',
    VALID + '\r\n#ignored line',
    VALID + '\n',
  ]) {
    const pool = new ProxyHealthPool()
    assert.equal(pool.refresh([raw], 0), 0,
      'refresh must validate the exact whole endpoint, not one extractable feed line')
    assert.equal(pool.summary(0).candidates, 0)
    assert.equal(pool.select(0), null)
  }
})

test('EXPECTED RED: the raw candidate must not carry trailing spaces or tab into select()', () => {
  for (const raw of [
    VALID + ' ',
    VALID + '\t',
    VALID + '\r',
  ]) {
    const pool = new ProxyHealthPool()
    assert.equal(pool.refresh([raw], 0), 0, 'noncanonical URL is not inventory')
    assert.deepEqual(pool.dueForProbe(0), [])
  }
})

test('EXPECTED RED: hidden unsafe/private second address must not ride behind one valid line', () => {
  const raw = VALID + '\n127.0.0.1:80'
  const pool = new ProxyHealthPool()
  assert.equal(pool.refresh([raw], 100), 0,
    'a valid first line does not authorize a malformed multi-line endpoint')
  assert.equal(pool.select(100), null)
  assert.deepEqual(pool.dueForProbe(100), [])
})
