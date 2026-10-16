import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  physicalCaptureNanoseconds,
  samePhysicalCaptureInstant,
} from '../scripts/retailer-physical-civil-clock.mjs'
import {
  RETAILER_REVIEWED_FIXTURES,
  readBoundedRegularReviewedFixture,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Independent QA1 frozen product #3715: exact civil chronology, not source approval.
// Genuine six sanitized historical M1 archives; no external retailer HTTP.
// This suite does NOT claim to repair direct catalog #3711 or adapters #3701.
function alias(iso, offsetMinutes) {
  const instant = Date.parse(iso)
  assert.ok(Number.isFinite(instant), 'historical input is an ISO capture')
  const local = new Date(instant + offsetMinutes * 60_000)
    .toISOString().slice(0, 19)
  const fractional = /(?:\.(\d{1,9}))?(?:Z|[+-]\d\d:\d\d)$/.exec(iso)
  assert.ok(fractional)
  const suffix = fractional[1] ? '.' + fractional[1] : ''
  const absolute = Math.abs(offsetMinutes)
  const sign = offsetMinutes < 0 ? '-' : '+'
  return local + suffix + sign +
    String(Math.floor(absolute / 60)).padStart(2, '0') + ':' +
    String(absolute % 60).padStart(2, '0')
}

const legalOffsets = Array.from(
  { length: 14 * 60 + 12 * 60 + 1 },
  (_, index) => index - 12 * 60,
)

test('every physical-minute UTC offset from -12:00 to +14:00 is a lawful identity alias', () => {
  const original = '2026-10-04T18:08:57.837123456Z'
  const exactNs = physicalCaptureNanoseconds(original)
  assert.equal(typeof exactNs, 'bigint')
  for (const offset of legalOffsets) {
    // Crucial: -00:00 is "offset unknown", never an alternative to UTC.
    if (offset === 0) continue
    const representation = alias(original, offset)
    assert.equal(physicalCaptureNanoseconds(representation), exactNs,
      'same physical capture at civil offset ' + offset)
    assert.equal(samePhysicalCaptureInstant(original, representation), true)
  }
  assert.equal(legalOffsets.length, 1561)
  assert.equal(samePhysicalCaptureInstant(
    original, alias(original, 0)), true, 'known explicit +00:00 is legal')
  assert.equal(physicalCaptureNanoseconds('2026-10-04T18:08:57.837123456-00:00'), null)
})

test('forbidden civil ranges cannot masquerade as legal timestamps even for the same UTC instant', () => {
  const original = '2026-10-04T18:08:57.837123456Z'
  // These intentionally preserve the true instant via clock/offset aliases:
  // accepting any would mislabel impossible civil provenance as reviewed.
  for (const offset of [-14 * 60, -13 * 60, -12 * 60 - 1, -12 * 60 - 59,
    14 * 60 + 1, 14 * 60 + 59, 15 * 60]) {
    const representation = alias(original, offset)
    assert.equal(Date.parse(representation), Date.parse(original),
      'control: only civil notation changed')
    assert.equal(physicalCaptureNanoseconds(representation), null,
      'illegal physical civil timezone: ' + representation)
    assert.equal(samePhysicalCaptureInstant(original, representation), false)
  }
})

test('real UTC month/year/leap-day boundaries do not change physical capture identity', () => {
  for (const iso of [
    '2024-02-29T00:00:00.000000001Z',
    '2024-02-29T23:59:59.999999999Z',
    '2026-12-31T23:59:59.000000001Z',
    '2026-01-01T00:00:00.999999999Z',
    '2000-03-01T00:00:00.000000001Z',
    '0099-12-31T23:59:59.999999999Z',
  ]) {
    const nanos = physicalCaptureNanoseconds(iso)
    assert.equal(typeof nanos, 'bigint')
    for (const offset of [-720, -330, 0, 345, 840]) {
      const candidate = alias(iso, offset)
      assert.equal(physicalCaptureNanoseconds(candidate), nanos, iso + ' -> ' + candidate)
    }
  }
  for (const iso of [
    '1900-02-29T12:00:00Z',
    '2100-02-29T12:00:00Z',
    '2026-02-29T12:00:00Z',
    '2026-04-31T12:00:00Z',
    '0000-12-31T23:59:59Z',
  ]) assert.equal(physicalCaptureNanoseconds(iso), null, iso)
})

test('a distinct one-nanosecond recapture never collapses into a differently offset alias', () => {
  const original = '2026-10-04T18:08:57.837123456Z'
  const later = '2026-10-04T18:08:57.837123457Z'
  const earlier = '2026-10-04T18:08:57.837123455Z'
  const initialNs = physicalCaptureNanoseconds(original)
  assert.equal(physicalCaptureNanoseconds(later) - initialNs, 1n)
  assert.equal(initialNs - physicalCaptureNanoseconds(earlier), 1n)
  for (const offset of [-720, -345, 0, 345, 840]) {
    assert.equal(samePhysicalCaptureInstant(original, alias(later, offset)), false)
    assert.equal(samePhysicalCaptureInstant(original, alias(earlier, offset)), false)
  }
})

test('each of six actual archived PLUS/Deka clocks survives physical legal aliasing', async t => {
  const root = new URL('../fixtures/m1/', import.meta.url)
  const records = await Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(name, root)))))
  assert.equal(records.length, 6)
  for (const record of records) {
    const source = record.source
    await t.test(source.supermarket + ':' + source.kind, () => {
      const actual = source.capturedAt
      const nanos = physicalCaptureNanoseconds(actual)
      assert.equal(typeof nanos, 'bigint', 'genuine historical timestamp must stay valid')
      for (const offset of [-720, -1, 0, 1, 120, 840]) {
        assert.equal(physicalCaptureNanoseconds(alias(actual, offset)), nanos,
          'genuine archived capture exact physical identity preserved')
      }
      for (const offset of [-721, -780, -840, 841]) {
        assert.equal(physicalCaptureNanoseconds(alias(actual, offset)), null,
          'impossible civil clock must never be certified')
      }
    })
  }
})
