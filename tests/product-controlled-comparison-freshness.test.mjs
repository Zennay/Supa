import assert from 'node:assert/strict'
import test from 'node:test'

import { projectFreshControlledComparisonCatalogs } from '../src/data/trustedMultipackComparisonCatalog.ts'

const baselineStore = Object.freeze({ id: 'plus-leiden', supermarket: 'plus' })
const candidateStore = Object.freeze({ id: 'deka-leiden', supermarket: 'dekamarkt' })
const referenceTime = '2026-10-10T12:00:00Z'

function observation(supermarket, id, capturedAt = referenceTime) {
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
      supermarket,
      kind: 'product',
      url: supermarket === 'plus'
        ? 'https://www.plus.nl/controlled-water'
        : 'https://www.dekamarkt.nl/controlled-water',
      capturedAt,
      sha256: 'a'.repeat(64),
    },
  }
}

function project({
  plus = [observation('plus', 'water')],
  deka = [observation('dekamarkt', 'water')],
  baseline = baselineStore,
  candidate = candidateStore,
  now = referenceTime,
} = {}) {
  return projectFreshControlledComparisonCatalogs({
    baselineObservations: plus,
    candidateObservations: deka,
    baselineStore: baseline,
    candidateStore: candidate,
    referenceTime: now,
  })
}

test('controlled comparison preserves retailer-specific multipack counts, cent prices and distinct store ids', () => {
  const source = Object.freeze([observation('plus', 'water')])
  const before = structuredClone(source)
  const result = project({ plus: source })
  assert.ok(result)
  assert.equal(result.captureWindowHours, 0)
  assert.deepEqual(result.baseline.map(p => [p.id, p.storeId, p.packAmount, p.packCount, p.priceCents]), [
    ['plus-leiden:water', 'plus-leiden', 1, 6, 199],
  ])
  assert.deepEqual(result.candidate.map(p => p.id), ['deka-leiden:water'])
  assert.deepEqual(source, before)
  assert.deepEqual(baselineStore, { id: 'plus-leiden', supermarket: 'plus' })
})

test('freshness gate accepts the exact 24-hour boundary and timezone-equivalent instants', () => {
  assert.equal(project({
    plus: [observation('plus', 'water', '2026-10-09T12:00:00Z')],
    deka: [observation('dekamarkt', 'water', '2026-10-10T14:00:00+02:00')],
  })?.captureWindowHours, 24)

  assert.equal(project({
    plus: [observation('plus', 'water', '2026-10-10T12:00:00Z')],
    deka: [observation('dekamarkt', 'water', '2026-10-10T14:00:00+02:00')],
  })?.captureWindowHours, 0)

  assert.equal(project({
    plus: [observation('plus', 'water', '2026-10-10T12:00:00.000Z')],
    deka: [observation('dekamarkt', 'water', '2026-10-10T12:00:00Z')],
  })?.captureWindowHours, 0)
})

test('future, stale or mixed-window records invalidate the WHOLE two-store catalog', () => {
  assert.equal(project({
    plus: [observation('plus', 'water', '2026-10-10T12:00:01Z')],
  }), null)
  assert.equal(project({
    plus: [observation('plus', 'water', '2026-10-09T11:59:59Z')],
  }), null)
  assert.equal(project({
    plus: [
      observation('plus', 'water'),
      observation('plus', 'rice', '2026-10-09T11:59:59Z'),
    ],
  }), null)
  assert.equal(project({
    deka: [observation('dekamarkt', 'water', '2026-10-11T12:00:00Z')],
  }), null)
})

test('rejects missing clock, local-time ambiguities, invalid calendar dates and non-ISO timestamps', () => {
  for (const now of [
    '', '2026-10-10T12:00:00', '2026-10-10', 'not a date',
    '2026-02-31T12:00:00Z', '2026-10-10T25:00:00Z',
    '2026-10-10T12:00:00+14:01', '2026-10-10T12:00:00+24:00',
  ]) {
    assert.equal(project({ now }), null, now)
  }
  for (const capturedAt of [
    '2026-10-10T12:00:00', '2026-02-31T12:00:00Z',
    '2026-10-10T12:00:00+15:00', '2026-10-10',
  ]) {
    assert.equal(project({
      plus: [observation('plus', 'water', capturedAt)],
    }), null, capturedAt)
  }
})

test('retailer crossover, duplicate products, missing products, promotions and malformed pack reject both catalogs', () => {
  assert.equal(project({ baseline: candidateStore, candidate: baselineStore }), null)
  assert.equal(project({ baseline: baselineStore, candidate: baselineStore }), null)
  assert.equal(project({ deka: [] }), null)
  assert.equal(project({ plus: [observation('plus', 'same'), observation('plus', 'same')] }), null)
  assert.equal(project({ plus: [observation('dekamarkt', 'wrong')] }), null)
  assert.equal(project({ deka: [null] }), null)
  assert.equal(project({
    deka: [{ ...observation('dekamarkt', 'water'), availability: 'unknown' }],
  }), null)
  assert.equal(project({
    deka: [{ ...observation('dekamarkt', 'water'), offer: { label: '2+1' } }],
  }), null)
  assert.equal(project({
    plus: [{ ...observation('plus', 'water'), pack: { rawText: '6 x 1 l', amount: 1, unit: 'l', count: 1 } }],
  }), null)
})

test('unexpected getter input remains fail-closed and emits no partial catalog', () => {
  const hostile = observation('plus', 'water')
  Object.defineProperty(hostile.provenance, 'capturedAt', {
    enumerable: true,
    get() { throw new Error('PRIVATE_PARTICIPANT_KEY') },
  })
  assert.doesNotThrow(() => project({ plus: [hostile] }))
  assert.equal(project({ plus: [hostile] }), null)
})
