import assert from 'node:assert/strict'
import test from 'node:test'

import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { reviewPrivateRetailerOffers } from '../scripts/qa-retailer-offer-baseline-corroboration.mjs'
import { auditPrivateRetailerCaptureEvents } from '../scripts/qa-retailer-reviewed-event-consistency.mjs'

// Direct exported QA API accepts arbitrary JS callers despite historical CLI
// passing inert JSON. Prevent any supplied getter or Proxy trap from executing.
// All fixtures remain the original checked-in sanitized historical M1 shapes.
const asOf = '2026-10-15T00:00:00.000Z'
const auditors = [
  ['historical offer reviewer', batch =>
    reviewPrivateRetailerOffers(batch, { asOf }),
  /Private retailer offer corroboration QA refused/],
  ['historical event reviewer', batch =>
    auditPrivateRetailerCaptureEvents(batch, { asOf }),
  /Private retailer event consistency QA refused/],
]

async function historic() {
  return structuredClone(await loadReviewedRepositoryFixtures())
}

function plantGetter(batch, location, observed) {
  let object
  let prop
  if (location === 'summary') {
    object = batch.summary
    prop = 'mode'
  } else if (location === 'observation') {
    object = batch.results[0].observations[0]
    prop = 'sourceProductId'
  } else {
    object = batch.results[0].observations[0].provenance
    prop = 'url'
  }
  Object.defineProperty(object, prop, {
    configurable: true, enumerable: true,
    get() {
      observed.count++
      throw new Error('ACTIVE_UNTRUSTED_HISTORIC_QA_GETTER')
    },
  })
}

test('unchanged six reviewed historical fixtures remain valid for both private direct QA auditors', async () => {
  const batch = await historic()
  const before = structuredClone(batch)
  for (const [name, audit] of auditors) {
    const report = audit(batch)
    assert.equal(report.productionEnabled, false, name)
    assert.equal(report.publicSavingsClaimEligible, false, name)
    assert.equal(report.externalRequests, 0, name)
  }
  assert.deepEqual(batch, before)
})

for (const [name, audit, rejection] of auditors) {
  for (const location of ['summary', 'observation', 'provenance']) {
    test(name + ': direct hostile ' + location + ' accessor must be inert', async () => {
      const batch = await historic()
      const observed = { count: 0 }
      plantGetter(batch, location, observed)
      assert.throws(() => audit(batch), rejection,
        'direct QA export must abstain without executing arbitrary caller code')
      assert.equal(observed.count, 0,
        'caller-controlled source getter must not execute')
    })
  }
  test(name + ': direct Proxy summary cannot execute supplied traps', async () => {
    const batch = await historic()
    let traps = 0
    const original = batch.summary
    batch.summary = new Proxy(original, {
      get(target, prop, receiver) {
        traps++
        throw new Error('ACTIVE_UNTRUSTED_HISTORIC_QA_PROXY_' + String(prop))
      },
    })
    assert.throws(() => audit(batch), rejection)
    assert.equal(traps, 0)
  })
}
