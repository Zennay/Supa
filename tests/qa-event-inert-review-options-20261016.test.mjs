import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { auditPrivateRetailerCaptureEvents } from '../scripts/qa-retailer-reviewed-event-consistency.mjs'

const FIXED_CLOCK = '2026-10-15T00:00:00.000Z'
const deny = /Private retailer event consistency QA refused/
const fixtures = () => loadReviewedRepositoryFixtures()

test('inert explicit options preserves exact historical six-source positive report', async () => {
  const batch = await fixtures()
  const unchanged = structuredClone(batch)
  const report = auditPrivateRetailerCaptureEvents(batch, { asOf: FIXED_CLOCK })
  assert.equal(report.sourceResults, 6)
  assert.equal(report.reviewedObservations, 16)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.deepEqual(batch, unchanged)
})

test('direct options asOf getter must not execute before admission', async () => {
  const batch = await fixtures()
  let invocations = 0
  const options = {}
  Object.defineProperty(options, 'asOf', {
    enumerable: true, get() {
      invocations++
      throw new Error('UNTRUSTED_REVIEW_OPTIONS_GETTER')
    },
  })
  assert.throws(() => auditPrivateRetailerCaptureEvents(batch, options), deny)
  assert.equal(invocations, 0)
})

test('direct options Proxy.get trap must not execute before admission', async () => {
  const batch = await fixtures()
  let invocations = 0
  const options = new Proxy({ asOf: FIXED_CLOCK }, {
    get() {
      invocations++
      throw new Error('UNTRUSTED_REVIEW_OPTIONS_PROXY')
    },
  })
  assert.throws(() => auditPrivateRetailerCaptureEvents(batch, options), deny)
  assert.equal(invocations, 0)
})

test('inherited review clock is not permitted to override own-data chronology', async () => {
  const batch = await fixtures()
  const options = Object.create({ asOf: FIXED_CLOCK })
  assert.throws(() => auditPrivateRetailerCaptureEvents(batch, options), deny)
})

test('non-record and non-string review options fail closed', async t => {
  const batch = await fixtures()
  for (const options of [null, false, 12, [], 'not-an-object',
                         { asOf: { toString() { throw Error('MUST_BE_INERT') } } }]) {
    await t.test(typeof options + (Array.isArray(options) ? '-array' : ''), () => {
      assert.throws(() => auditPrivateRetailerCaptureEvents(batch, options), deny)
    })
  }
})
