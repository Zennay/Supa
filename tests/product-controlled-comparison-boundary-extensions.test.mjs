import assert from 'node:assert/strict'
import test from 'node:test'

import { projectFreshControlledComparisonCatalogs } from '../src/data/trustedMultipackComparisonCatalog.ts'

const plus = { id: 'plus-leiden', supermarket: 'plus' }
const deka = { id: 'deka-leiden', supermarket: 'dekamarkt' }

function raw(supermarket, id, capturedAt) {
  return {
    supermarket,
    sourceProductId: id,
    name: 'Water six pack',
    currentPriceCents: 199,
    currency: 'EUR',
    pack: { rawText: '6 x 1 l', amount: 1, unit: 'l' },
    offer: null,
    availability: 'available',
    provenance: {
      supermarket, kind: 'product',
      url: supermarket === 'plus'
        ? 'https://www.plus.nl/controlled-water'
        : 'https://www.dekamarkt.nl/controlled-water',
      capturedAt, sha256: 'b'.repeat(64),
    },
  }
}

function result(first, second, referenceTime) {
  return projectFreshControlledComparisonCatalogs({
    baselineObservations: [raw('plus', 'water', first)],
    candidateObservations: [raw('dekamarkt', 'water', second)],
    baselineStore: plus, candidateStore: deka, referenceTime,
  })
}

test('defensively refuses null, scalars and accessors instead of throwing before a trust check', () => {
  for (const value of [null, undefined, 7, false, 'test', []]) {
    assert.doesNotThrow(() => projectFreshControlledComparisonCatalogs(value))
    assert.equal(projectFreshControlledComparisonCatalogs(value), null)
  }
  const malicious = {
    get referenceTime() { throw new Error('PRIVATE-INFO') },
  }
  assert.equal(projectFreshControlledComparisonCatalogs(malicious), null)
})

test('24h elapsed across timezone offsets is allowed, any extra millisecond is not', () => {
  assert.equal(result(
    '2026-10-09T12:00:00.000Z',
    '2026-10-10T14:00:00.000+02:00',
    '2026-10-10T12:00:00Z',
  )?.captureWindowHours, 24)
  assert.equal(result(
    '2026-10-09T11:59:59.999Z',
    '2026-10-10T12:00:00Z',
    '2026-10-10T12:00:00Z',
  ), null)
})

test('calendar input is strict for leap days and large valid timezone offsets', () => {
  assert.equal(result(
    '2024-02-29T10:00:00Z', '2024-02-29T11:00:00Z', '2024-02-29T12:00:00Z',
  )?.captureWindowHours, 1)
  assert.equal(result(
    '2025-02-29T10:00:00Z', '2025-02-29T11:00:00Z', '2025-02-29T12:00:00Z',
  ), null)
  assert.equal(result(
    '2024-02-29T10:00:00+14:00',
    '2024-02-28T20:00:00Z',
    '2024-02-29T20:00:00Z',
  ), null, 'candidate must be no older than 24 hours relative to explicit reference')
  assert.equal(result(
    '2026-10-10T11:00:00Z',
    '2026-10-10T12:00:00Z',
    '2026-10-10T12:00:00+00:00',
  )?.captureWindowHours, 1)
})

test('one stale row among otherwise fresh same-store products rejects both projected catalogs', () => {
  const plusRows = [
    raw('plus', 'water', '2026-10-10T12:00:00Z'),
    raw('plus', 'rice', '2026-10-09T11:59:59Z'),
  ]
  const result = projectFreshControlledComparisonCatalogs({
    baselineObservations: plusRows,
    candidateObservations: [raw('dekamarkt', 'water', '2026-10-10T12:00:00Z')],
    baselineStore: plus, candidateStore: deka,
    referenceTime: '2026-10-10T12:00:00Z',
  })
  assert.equal(result, null)
})
