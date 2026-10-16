import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import {
  isValidPrivateCivilCaptureTime,
  ingestCivilClockCheckedReviewedBatch,
  main,
} from '../scripts/retailer-private-civil-clock-preflight.mjs'
import {
  RETAILER_REVIEWED_FIXTURES,
  readBoundedRegularReviewedFixture,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'

async function fixtures() {
  const root = new URL('../fixtures/m1/', import.meta.url)
  return Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(name, root)))))
}

function offsetAlias(iso, sign, hour, minute = 0) {
  const offset = (sign === '+' ? 1 : -1) * (hour * 60 + minute)
  const local = new Date(Date.parse(iso) + offset * 60000).toISOString().slice(0, 23)
  return local + sign + String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0')
}

test('six original historical PLUS/Deka captures remain private-only and accepted', async () => {
  const { summary } = ingestCivilClockCheckedReviewedBatch(await fixtures())
  assert.equal(summary.sources, 6)
  assert.equal(summary.acceptedSources, 6)
  assert.equal(summary.rejectedSources, 0)
  assert.equal(summary.productionEnabled, false)
  assert.equal(summary.permissionVerified, false)
  assert.equal(summary.publicSavingsClaimEligible, false)
  assert.ok(summary.observations >= 6)
})

test('six shapes: impossible negative civil UTC offsets fail before ingestion; legal endpoints pass', async t => {
  const baseline = await fixtures()
  for (const sample of baseline) {
    const key = sample.source.supermarket + ':' + sample.source.kind
    await t.test(key, () => {
      for (const [sign, hour, minute] of [['-', 12, 1], ['-', 13, 0], ['-', 14, 0], ['+', 14, 1]]) {
        const changed = structuredClone(sample)
        changed.source.capturedAt = offsetAlias(sample.source.capturedAt, sign, hour, minute)
        assert.equal(Date.parse(changed.source.capturedAt), Date.parse(sample.source.capturedAt))
        assert.equal(isValidPrivateCivilCaptureTime(changed.source.capturedAt), false)
        assert.throws(() => ingestCivilClockCheckedReviewedBatch([changed]), /civil-clock preflight refused/)
      }
      for (const [sign, hour] of [['-', 12], ['+', 14]]) {
        const changed = structuredClone(sample)
        changed.source.capturedAt = offsetAlias(sample.source.capturedAt, sign, hour)
        assert.equal(Date.parse(changed.source.capturedAt), Date.parse(sample.source.capturedAt))
        assert.equal(isValidPrivateCivilCaptureTime(changed.source.capturedAt), true)
        const { summary } = ingestCivilClockCheckedReviewedBatch([changed])
        assert.equal(summary.acceptedSources, 1)
        assert.equal(summary.productionEnabled, false)
      }
    })
  }
})

test('an otherwise valid six-shape batch is atomic when one impossible local offset is inserted', async () => {
  const records = await fixtures()
  records[3].source.capturedAt = offsetAlias(records[3].source.capturedAt, '-', 13)
  assert.throws(() => ingestCivilClockCheckedReviewedBatch(records), /civil-clock preflight refused/)
})

test('strict civil Gregorian dates, source clock chronology, and missing zone fail closed', () => {
  const fixed = Date.parse('2026-10-16T22:00:00Z')
  const valid = [
    '2024-02-29T00:00:00Z',
    '2026-10-16T22:00:00.123456789+00:00',
    '2026-10-16T10:00:00-12:00',
    '2026-10-17T12:00:00+14:00',
  ]
  for (const s of valid) assert.equal(isValidPrivateCivilCaptureTime(s, fixed), true, s)
  const invalid = [
    '2026-02-30T00:00:00Z', '2026-04-31T00:00:00Z',
    '1900-02-29T00:00:00Z', '2026-10-16T24:00:00Z',
    '2026-10-16T22:60:00Z', '2026-10-16T22:00:60Z',
    '2026-10-16T22:00:00', '2026-10-16T22:00:00-12:01',
    '2026-10-16T22:00:00+14:01', '2026-10-16T22:00:00-13:00',
    '2026-10-16T22:02:00Z', '2099-01-01T00:00:00Z',
    '2026-10-16T22:00:00.1234567890Z',
  ]
  for (const s of invalid) assert.equal(isValidPrivateCivilCaptureTime(s, fixed), false, s)
})

test('untrusted input/options cannot trigger getters or proxy traps before inert admission', async () => {
  const samples = await fixtures()
  let touched = 0
  const poisoned = structuredClone(samples[0])
  Object.defineProperty(poisoned.source, 'capturedAt', {
    enumerable: true,
    get() { touched++; throw new Error('caller getter executed') },
  })
  assert.throws(() => ingestCivilClockCheckedReviewedBatch([poisoned]), /inert JSON/)
  assert.equal(touched, 0)
  assert.throws(() => ingestCivilClockCheckedReviewedBatch(new Proxy(samples, {})), /inert JSON/)
  assert.throws(() => ingestCivilClockCheckedReviewedBatch(samples, { referenceTime: Infinity }), /inert JSON/)
  assert.throws(() => ingestCivilClockCheckedReviewedBatch(samples, { onAccepted: true }), /civil-clock preflight refused/)
})

test('offline CLI emits only aggregate private counts and refuses arbitrary flags', async () => {
  let output = ''
  const result = await main([], value => { output += value })
  const parsed = JSON.parse(output)
  assert.equal(result.acceptedSources, 6)
  assert.equal(parsed.civilClockPreflight, true)
  assert.equal(parsed.productionEnabled, false)
  assert.equal(parsed.permissionVerified, false)
  assert.equal(parsed.publicSavingsClaimEligible, false)
  for (const sample of await fixtures()) {
    assert.equal(output.includes(sample.source.url), false)
    assert.equal(output.includes(sample.source.id), false)
  }
  await assert.rejects(main(['--url', 'https://www.plus.nl/']), /civil-clock preflight refused/)
})
