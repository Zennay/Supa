import assert from 'node:assert/strict'
import test from 'node:test'
import { projectFreshControlledComparisonCatalogs } from '../src/data/trustedMultipackComparisonCatalog.ts'

// Additional independent edge coverage after #1149; all timestamps/prices synthetic.
const plusStore = Object.freeze({ id: 'qa-plus', supermarket: 'plus' })
const dekaStore = Object.freeze({ id: 'qa-deka', supermarket: 'dekamarkt' })
function observation(supermarket, capturedAt) {
  return {
    supermarket, sourceProductId: 'water-six-pack', name: 'Six litres of water',
    currentPriceCents: 199, currency: 'EUR',
    pack: { rawText: '6 x 1 l', amount: 1, unit: 'l' },
    offer: null, availability: 'available',
    provenance: {
      supermarket, kind: 'product',
      url: supermarket === 'plus'
        ? 'https://www.plus.nl/synthetic-water'
        : 'https://www.dekamarkt.nl/synthetic-water',
      capturedAt, sha256: 'f'.repeat(64),
    },
  }
}
function project(plusTime, dekaTime, referenceTime) {
  return projectFreshControlledComparisonCatalogs({
    baselineObservations: [observation('plus', plusTime)],
    candidateObservations: [observation('dekamarkt', dekaTime)],
    baselineStore: plusStore, candidateStore: dekaStore,
    referenceTime,
  })
}

test('QA #1148: even a non-future submillisecond source must fail closed', () => {
  assert.equal(project(
    '2026-10-10T11:59:59.000000001Z',
    '2026-10-10T11:59:59Z',
    '2026-10-10T12:00:00Z',
  ), null)
})

test('QA #1148: unsupported reference precision alone cannot approve captures', () => {
  assert.equal(project(
    '2026-10-10T11:59:59.000Z',
    '2026-10-10T11:59:59Z',
    '2026-10-10T12:00:00.000000001Z',
  ), null)
})

test('QA #1148: nonzero fifth fractional digit is rejected, not rounded', () => {
  assert.equal(project(
    '2026-10-10T11:59:59.00101Z',
    '2026-10-10T11:59:59.001Z',
    '2026-10-10T12:00:00.001Z',
  ), null)
})

test('QA #1148: exact 24 elapsed hours survives 9-digit trailing zeros and negative offsets', () => {
  const valid = project(
    '2026-10-09T07:00:00.001000000-05:00',
    '2026-10-10T14:00:00.001+02:00',
    '2026-10-10T12:00:00.001000000Z',
  )
  assert.ok(valid)
  assert.equal(valid.captureWindowHours, 24)
  assert.equal(valid.baseline[0].packCount, 6)
  assert.equal(valid.candidate[0].priceCents, 199)
})
