import assert from 'node:assert/strict'
import test from 'node:test'
import {
  projectFreshControlledComparisonCatalogs,
} from '../src/data/trustedMultipackComparisonCatalog.ts'

// Independent QA against immutable product owner #1152 (84c2cc5), rather
// than assuming a later proposed repair changes the behavior.
// All source observations below are fictional fixtures, not field evidence.
const referenceTime = '2026-10-10T12:00:00Z'
function observation(supermarket, stamp) {
  return {
    supermarket, sourceProductId: 'qa-rice', name: 'Basmati rijst',
    currentPriceCents: 199, currency: 'EUR',
    pack: { rawText: '1 kg', amount: 1, unit: 'kg' },
    offer: null, availability: 'available',
    provenance: {
      supermarket, kind: 'product',
      url: supermarket === 'plus'
        ? 'https://www.plus.nl/qa-rice'
        : 'https://www.dekamarkt.nl/qa-rice',
      capturedAt: stamp, sha256: 'a'.repeat(64),
    },
  }
}

function sources(plus, deka) {
  return {
    baselineStore: { id: 'qa-plus', supermarket: 'plus' },
    candidateStore: { id: 'qa-deka', supermarket: 'dekamarkt' },
    baselineObservations: [observation('plus', plus)],
    candidateObservations: [observation('dekamarkt', deka)],
    referenceTime,
  }
}

test('QA independent: same store-capture instants 23 hours old have zero spread', () => {
  const input = sources('2026-10-09T13:00:00Z', '2026-10-09T13:00:00Z')
  const before = structuredClone(input)
  const output = projectFreshControlledComparisonCatalogs(input)
  assert.ok(output)
  assert.equal(output.captureWindowHours, 0)
  assert.deepEqual(input, before)
})

test('QA independent: reference age must not inflate one-hour retailer observation spread', () => {
  const output = projectFreshControlledComparisonCatalogs(
    sources('2026-10-09T13:00:00Z', '2026-10-09T14:00:00Z'),
  )
  assert.ok(output)
  assert.equal(output.captureWindowHours, 1)
})

test('QA independent: cross-store exact 24h spread is inclusive', () => {
  const output = projectFreshControlledComparisonCatalogs(
    sources('2026-10-09T12:00:00Z', '2026-10-10T12:00:00Z'),
  )
  assert.ok(output)
  assert.equal(output.captureWindowHours, 24)
})

test('QA independent: empty catalog cannot manufacture an observation window', () => {
  const base = sources(referenceTime, referenceTime)
  for (const pair of [
    { ...base, baselineObservations: [] },
    { ...base, candidateObservations: [] },
    { ...base, baselineObservations: [], candidateObservations: [] },
  ]) {
    assert.equal(projectFreshControlledComparisonCatalogs(pair), null)
  }
})
