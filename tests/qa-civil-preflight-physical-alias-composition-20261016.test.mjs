import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  ingestCivilClockCheckedReviewedBatch,
  isValidPrivateCivilCaptureTime,
} from '../scripts/retailer-private-civil-clock-preflight.mjs'
import {
  RETAILER_REVIEWED_FIXTURES,
  readBoundedRegularReviewedFixture,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Independent, tests-only composition regression for open P1 #3692 / P2 #3702.
// Existing opt-in civil-clock preflight must not turn one *physical* private
// capture into multiple independently counted reviewed sources. All inputs
// originate from immutable, sanitized, checked-in M1 fixtures; no network.
async function fixtures() {
  const root = new URL('../fixtures/m1/', import.meta.url)
  return Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(name, root)))))
}

function renamed(source) {
  const alias = structuredClone(source)
  alias.source.id += '-qa-physical-alias'
  assert.notEqual(alias.source.id, source.source.id)
  return alias
}

// Preserve the very same physical millisecond instant but spell it using a
// legal UTC civil-offset alias. The source record and contents are otherwise
// identical (except for mutable internal ID).
function sameInstantAtOffset(source, offsetMinutes) {
  const alias = renamed(source)
  const sign = offsetMinutes < 0 ? '-' : '+'
  const abs = Math.abs(offsetMinutes)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  const localMs = Date.parse(source.source.capturedAt) + offsetMinutes * 60_000
  alias.source.capturedAt =
    new Date(localMs).toISOString().slice(0, 23) + sign + hh + ':' + mm
  assert.equal(Date.parse(alias.source.capturedAt), Date.parse(source.source.capturedAt))
  assert.equal(isValidPrivateCivilCaptureTime(alias.source.capturedAt), true)
  return alias
}

function assertPrivate(summary, count) {
  assert.equal(summary.sources, count)
  assert.equal(summary.acceptedSources, count)
  assert.equal(summary.rejectedSources, 0)
  assert.equal(summary.productionEnabled, false)
  assert.equal(summary.permissionVerified, false)
  assert.equal(summary.publicSavingsClaimEligible, false)
}

test('genuine independent PLUS/Deka physical historical captures stay strictly private', async () => {
  const originals = await fixtures()
  assertPrivate(ingestCivilClockCheckedReviewedBatch(originals).summary, 6)
  assertPrivate(ingestCivilClockCheckedReviewedBatch([originals[0], originals[3]]).summary, 2)
})

test('legal UTC offset aliases of a single PLUS physical capture still parse privately', async () => {
  const [plus] = await fixtures()
  for (const offset of [0, 120, -720, 840]) {
    const alias = sameInstantAtOffset(plus, offset)
    assertPrivate(ingestCivilClockCheckedReviewedBatch([alias]).summary, 1)
  }
})

test('P1 #3692: a changed app-level ID must not double-count one immutable PLUS capture', async () => {
  const [plus] = await fixtures()
  const duplicate = renamed(plus)
  assert.equal(duplicate.source.url, plus.source.url)
  assert.equal(duplicate.source.sha256, plus.source.sha256)
  assert.equal(duplicate.source.capturedAt, plus.source.capturedAt)
  assert.throws(() => ingestCivilClockCheckedReviewedBatch([plus, duplicate]),
    'same PLUS capture under a new internal ID must be refused atomically')
})

test('P1 #3692: genuine Deka + PLUS plus a duplicated PLUS is not three source proofs', async () => {
  const originals = await fixtures()
  const plus = originals[0]
  const deka = originals[3]
  assertPrivate(ingestCivilClockCheckedReviewedBatch([plus, deka]).summary, 2)
  assert.throws(() => ingestCivilClockCheckedReviewedBatch([plus, deka, renamed(plus)]),
    'adding a physical alias cannot increase independent source coverage')
})

for (const offset of [0, 120, -720, 840]) {
  test('P2 #3702: equivalent UTC alias (' + offset + ' min) must not double-count PLUS', async () => {
    const [plus] = await fixtures()
    const duplicate = sameInstantAtOffset(plus, offset)
    assert.notEqual(duplicate.source.capturedAt, plus.source.capturedAt)
    assert.equal(duplicate.source.sha256, plus.source.sha256)
    assert.equal(duplicate.source.url, plus.source.url)
    assert.throws(() => ingestCivilClockCheckedReviewedBatch([plus, duplicate]),
      'a civil-clock-valid offset spelling is not a second physical capture')
  })
}

test('existing same-app-ID duplicate denial remains intact', async () => {
  const [plus] = await fixtures()
  assert.throws(() => ingestCivilClockCheckedReviewedBatch([plus, structuredClone(plus)]))
})

test('impossible civil clock still fails even if app-level capture ID was changed', async () => {
  const [plus] = await fixtures()
  const impossible = sameInstantAtOffset(plus, -720)
  impossible.source.capturedAt = impossible.source.capturedAt.replace(/-12:00$/, '-13:00')
  assert.equal(isValidPrivateCivilCaptureTime(impossible.source.capturedAt), false)
  assert.throws(() => ingestCivilClockCheckedReviewedBatch([plus, impossible]))
})
