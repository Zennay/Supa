import assert from 'node:assert/strict'
import test from 'node:test'
import { projectFreshControlledComparisonCatalogs } from '../src/data/trustedMultipackComparisonCatalog.ts'

// Independent synthetic proof of QA #1148, pinned to #1147 immutable head.
// The product owner source is intentionally UNCHANGED in this test-only draft.
const plusStore = Object.freeze({ id: 'qa-plus', supermarket: 'plus' })
const dekaStore = Object.freeze({ id: 'qa-dekamarkt', supermarket: 'dekamarkt' })

function observation(supermarket, capturedAt, id = 'controlled-water') {
  return {
    supermarket,
    sourceProductId: id,
    name: 'Controlled six-pack of water',
    currentPriceCents: 199, currency: 'EUR',
    pack: { rawText: '6 x 1 l', amount: 1, unit: 'l' },
    offer: null, availability: 'available',
    provenance: {
      supermarket, kind: 'product',
      url: supermarket === 'plus'
        ? 'https://www.plus.nl/qa-six-pack'
        : 'https://www.dekamarkt.nl/qa-six-pack',
      capturedAt, sha256: 'c'.repeat(64),
    },
  }
}

function project({ plus, deka, now }) {
  return projectFreshControlledComparisonCatalogs({
    baselineObservations: [observation('plus', plus)],
    candidateObservations: [observation('dekamarkt', deka)],
    baselineStore: plusStore, candidateStore: dekaStore,
    referenceTime: now,
  })
}

test('QA #1148: nonzero sub-millisecond PLUS capture cannot masquerade as current', () => {
  assert.equal(project({
    plus: '2026-10-10T12:00:00.000000001Z',
    deka: '2026-10-10T12:00:00.000Z',
    now: '2026-10-10T12:00:00.000Z',
  }), null, 'a one-nanosecond FUTURE capture must never be treated as present')
})

test('QA #1148: future capture after the same millisecond must fail closed with numeric offset', () => {
  assert.equal(project({
    plus: '2026-10-10T14:00:00.123000001+02:00',
    deka: '2026-10-10T12:00:00.123000000Z',
    now: '2026-10-10T12:00:00.123Z',
  }), null, 'Date.parse millisecond truncation must not erase true future capture')
})

test('QA #1148: sub-millisecond reference and newer capturedAt cannot manufacture valid freshness', () => {
  assert.equal(project({
    plus: '2026-10-10T12:00:00.000000002Z',
    deka: '2026-10-10T12:00:00.000000001Z',
    now: '2026-10-10T12:00:00.000000001Z',
  }), null, 'a strict no-future gate must preserve or reject precision that exceeds its clock')
})

test('QA #1148: one ambiguous-precision row must reject both previously trusted store batches', () => {
  const input = Object.freeze({
    baselineObservations: Object.freeze([
      observation('plus', '2026-10-10T12:00:00.000Z', 'fresh'),
      observation('plus', '2026-10-10T12:00:00.000000001Z', 'one-ns-future'),
    ]),
    candidateObservations: Object.freeze([
      observation('dekamarkt', '2026-10-10T12:00:00.000Z'),
    ]),
    baselineStore: plusStore, candidateStore: dekaStore,
    referenceTime: '2026-10-10T12:00:00Z',
  })
  assert.equal(projectFreshControlledComparisonCatalogs(input), null)
  assert.equal(input.baselineObservations[0].currentPriceCents, 199)
})

test('QA #1148 positive: trailing-zero fractional source timestamps remain precisely equivalent', () => {
  const valid = project({
    plus: '2026-10-09T12:00:00.123000000Z',
    deka: '2026-10-10T14:00:00.123+02:00',
    now: '2026-10-10T12:00:00.123000000Z',
  })
  assert.ok(valid)
  assert.equal(valid.captureWindowHours, 24)
  assert.equal(valid.baseline[0].packCount, 6)
  assert.equal(valid.candidate[0].packCount, 6)
  assert.equal(valid.baseline[0].priceCents, 199)
})

test('QA #1148 positive: ordinary millisecond timestamps and lower-precision zeroes work', () => {
  const valid = project({
    plus: '2026-10-10T12:00:00.12Z',
    deka: '2026-10-10T14:00:00.1200+02:00',
    now: '2026-10-10T12:00:00.120Z',
  })
  assert.ok(valid)
  assert.equal(valid.captureWindowHours, 0)
  assert.equal(valid.baseline.length, 1)
  assert.equal(valid.candidate.length, 1)
})
