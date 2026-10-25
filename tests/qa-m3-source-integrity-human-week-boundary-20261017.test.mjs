/**
 * Independent cross-boundary M3 QA: the opt-in six-source civil-clock
 * preflight must protect the *actual selected-week blank human worksheet*,
 * even though separately owned original ingest/direct-catalog APIs still have
 * independently recorded expected-RED regressions.
 *
 * Only six checked-in sanitized historical PLUS/Deka files; no retailer HTTP,
 * present-day prices, human field observations, licenses or production writes.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { RETAILER_REVIEWED_FIXTURES, readBoundedRegularReviewedFixture } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildCivilClockCheckedPrivatePlannedWeek } from '../scripts/retailer-private-civil-week-bridge.mjs'
import { ingestCivilClockCheckedReviewedBatch, buildCivilClockCheckedPrivateCatalog } from '../scripts/retailer-private-civil-clock-preflight.mjs'
import { buildPrivateSelectedWeekObservationWorksheet } from '../scripts/retailer-private-selected-week-observation.mjs'

const load = async () => Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
  readBoundedRegularReviewedFixture(fileURLToPath(new URL('../fixtures/m1/' + name, import.meta.url)))))
const refuse = /refus|invalid|civil.clock|capture|ingest|admission|review/iu

function offsetAlias(original, sign, hours, minutes = 0) {
  const delta = (hours * 60 + minutes) * 60_000 * (sign === '+' ? 1 : -1)
  const local = new Date(Date.parse(original) + delta).toISOString().slice(0, 23)
  return local + sign + String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0')
}
function assertPrivateOnly(result) {
  assert.equal(result.observedStorePrices, 0)
  assert.equal(result.productionReady, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.rows, 22)
  assert.equal((result.csv.match(/"UNOBSERVED_TEMPLATE_NOT_EVIDENCE"/gu) ?? []).length, 22)
  assert.ok(!/https:\/\/|sourceSha|snapshotSha256|capturedAt|priceCents/iu.test(result.csv))
}

test('six real historical captures become exactly 11x2 unobserved operator rows, not prices', async () => {
  const sources = await load()
  const frozen = structuredClone(sources)
  const { summary } = buildCivilClockCheckedPrivatePlannedWeek(sources)
  assert.equal(summary.retailerReviewRows, 22)
  assert.equal(summary.ingredientNeeds, 11)
  assert.equal(summary.sourcePermissionVerified, false)
  assert.equal(summary.publicSavingsClaimEligible, false)
  assert.equal(summary.productionReady, false)
  assert.equal(summary.externalRequests, 0)
  assertPrivateOnly(buildPrivateSelectedWeekObservationWorksheet(sources))
  assert.deepEqual(sources, frozen, 'source snapshots must remain unchanged')
})

test('all six source shapes: illegal UTC -12:01/-13/-14 are denied by actual private worksheet before operator rows', async () => {
  const baseline = await load()
  for (let i = 0; i < baseline.length; i++) {
    for (const [hours, minutes] of [[12, 1], [13, 0], [14, 0]]) {
      const changed = structuredClone(baseline)
      const original = changed[i].source.capturedAt
      changed[i].source.capturedAt = offsetAlias(original, '-', hours, minutes)
      assert.equal(Date.parse(changed[i].source.capturedAt), Date.parse(original))
      assert.throws(() => buildPrivateSelectedWeekObservationWorksheet(changed), refuse,
        changed[i].source.kind + ' illegal UTC -' + hours + ':' + minutes)
    }
  }
  assertPrivateOnly(buildPrivateSelectedWeekObservationWorksheet(baseline))
})

test('legal -12:00 and +14:00 preserve physical captures without licensing or publishing', async () => {
  const baseline = await load()
  for (const [sign, hours] of [['-', 12], ['+', 14]]) {
    const changed = structuredClone(baseline)
    for (const record of changed) {
      const original = record.source.capturedAt
      record.source.capturedAt = offsetAlias(original, sign, hours)
      assert.equal(Date.parse(record.source.capturedAt), Date.parse(original))
    }
    const result = buildPrivateSelectedWeekObservationWorksheet(changed)
    assertPrivateOnly(result)
    const { summary } = ingestCivilClockCheckedReviewedBatch(changed)
    assert.equal(summary.acceptedSources, 6)
    assert.equal(summary.productionEnabled, false)
    assert.equal(summary.permissionVerified, false)
    assert.equal(summary.publicSavingsClaimEligible, false)
  }
})

test('bare URL ? / # suffixes cannot enter the actual private worksheet through any historical source kind', async () => {
  const originals = await load()
  for (let i = 0; i < originals.length; i++) {
    for (const suffix of ['?', '#', '?#']) {
      const changed = structuredClone(originals)
      changed[i].source.url += suffix
      assert.throws(() => buildCivilClockCheckedPrivateCatalog(changed), refuse)
      assert.throws(() => buildPrivateSelectedWeekObservationWorksheet(changed), refuse)
    }
  }
})

test('one disallowed source in an otherwise genuine six-source batch refuses atomically', async () => {
  const records = await load()
  const invalid = structuredClone(records)
  invalid[0].source.capturedAt = offsetAlias(invalid[0].source.capturedAt, '-', 13)
  invalid[5].source.url += '#'
  assert.throws(() => buildPrivateSelectedWeekObservationWorksheet(invalid), refuse)
  assertPrivateOnly(buildPrivateSelectedWeekObservationWorksheet(records))
})
