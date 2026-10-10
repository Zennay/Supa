import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { RESEARCH_SOURCES } from '../scripts/m1-multistore-research.mjs'
import { auditResearchSnapshot } from '../scripts/m1-research-snapshot-audit.mjs'

// Direct API adversarial records are synthetic. No real retailer observations.
const source = RESEARCH_SOURCES.find(s => s.id === 'dirk-halvarine')
const body = Buffer.from('<html>mock approved research</html>')
const nowMs = Date.parse('2026-10-10T23:45:00.000Z')
const good = () => ({
  version: 1, type: 'research-only-not-price-proof',
  sourceId: source.id, store: source.store, url: source.url,
  observedAt: new Date(nowMs - 1_000).toISOString(), httpStatus: 200,
  mediaType: 'text/html', bytes: body.length,
  sha256: createHash('sha256').update(body).digest('hex'), proxyMode: 'direct',
})
const audit = metadata => auditResearchSnapshot({ sourceId: source.id, metadata, body, nowMs })

test('direct snapshot auditor reads only own data without invoking hostile getters', () => {
  let calls = 0
  const ownAccessor = good()
  Object.defineProperty(ownAccessor, 'sha256', {
    enumerable: true, get() { calls++; throw Error('should not run') },
  })
  assert.doesNotThrow(() => assert.equal(audit(ownAccessor).status, 'rejected'))
  const inherited = Object.create(good())
  assert.equal(audit(inherited).status, 'rejected')
  const weirdProto = Object.assign(Object.create(new Date()), good())
  assert.equal(audit(weirdProto).status, 'rejected')
  assert.equal(calls, 0)
})

test('revoked proxy and reflection trap metadata fail closed without running property getters', () => {
  const rev = Proxy.revocable(good(), {})
  rev.revoke()
  assert.doesNotThrow(() => assert.equal(audit(rev.proxy).status, 'rejected'))
  const trapped = new Proxy(good(), { getPrototypeOf() { throw Error('reflection error') } })
  assert.doesNotThrow(() => assert.equal(audit(trapped).status, 'rejected'))
})

test('transparent get-trap proxy never executes get trap; frozen and null-proto remain accepted', () => {
  let calls = 0
  const transparent = new Proxy(good(), { get() { calls++; throw Error('get trap') } })
  assert.equal(audit(transparent).status, 'manual-review')
  assert.equal(calls, 0)
  assert.equal(audit(Object.freeze(good())).status, 'manual-review')
  assert.equal(audit(Object.assign(Object.create(null), good())).status, 'manual-review')
})
