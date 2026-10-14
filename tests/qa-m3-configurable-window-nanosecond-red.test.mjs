import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts, m3BaselineStore,
  m3CandidateProducts, m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'

// Entirely synthetic baskets and clocks. No retailer visit, measured prices,
// source permission or public savings eligibility is established by this test.
const baseline = buildOneStoreBasket({
  store: m3BaselineStore, plan: m2InitialPlan, recipes: m2Recipes,
  activeDays: m2DefaultActiveDays, products: m3BaselineProducts,
})
const candidate = buildOneStoreBasket({
  store: m3CandidateStore, plan: m2InitialPlan, recipes: m2Recipes,
  activeDays: m2DefaultActiveDays, products: m3CandidateProducts,
})
assert.equal(baseline.unresolvedLineCount, 0)
assert.equal(candidate.unresolvedLineCount, 0)

// Oracle performs only whole-second parsing with Date.parse; it never relies
// on the engine's truncated interpretation of 1-9 fractional digits.
function exactNs(iso) {
  const match = /^(.*:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(iso)
  assert.ok(match, 'explicit-offset whole-second ISO timestamp required')
  const wholeSecondsMs = Date.parse(match[1] + match[3])
  assert.ok(Number.isFinite(wholeSecondsMs))
  return BigInt(wholeSecondsMs) * 1_000_000n +
    BigInt((match[2] ?? '').padEnd(9, '0'))
}

function studyAt(first, second) {
  return {
    schemaVersion: 1,
    studyId: 'synthetic-m3-time-precision',
    participantKey: 'qa-pseudonym-001',
    population: 'synthetic QA',
    region: 'synthetic QA',
    weekStart: '2026-03-23',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'synthetic-baseline-001', observedAt: first,
      source: 'manual-cart', provenanceNote: 'SYNTHETIC QA - no field evidence',
      basket: baseline,
    },
    candidate: {
      evidenceId: 'synthetic-candidate-001', observedAt: second,
      source: 'manual-cart', provenanceNote: 'SYNTHETIC QA - no field evidence',
      basket: candidate,
    },
  }
}

const overrunCases = [
  {
    label: '15-minute configurable limit at .123456 milliseconds',
    maxHours: 0.25,
    first: '2026-10-02T10:00:00.123456000Z',
    second: '2026-10-02T10:15:00.123456001Z',
  },
  {
    label: '90-minute configurable limit in reverse observation order',
    maxHours: 1.5,
    first: '2026-10-02T11:30:00.000000001Z',
    second: '2026-10-02T10:00:00.000000000Z',
  },
  {
    label: '24-hour default limit through spring DST +01 to +02',
    maxHours: 24,
    first: '2026-03-28T17:00:00.000000000+01:00',
    second: '2026-03-29T18:00:00.000000001+02:00',
  },
  {
    label: 'one-hour configurable limit across leap-day month rollover',
    maxHours: 1,
    first: '2024-02-29T23:30:00.500000000Z',
    second: '2024-03-01T00:30:00.500000001Z',
  },
]

for (const { label, maxHours, first, second } of overrunCases) {
  test(`M3 precision expected RED: ${label} must abstain at +1ns`, () => {
    const actualNs = exactNs(second) - exactNs(first)
    const absoluteNs = actualNs < 0n ? -actualNs : actualNs
    assert.equal(absoluteNs, BigInt(Math.round(maxHours * 3600)) * 1_000_000_000n + 1n)

    const result = assessWeeklyBasketStudy(studyAt(first, second), {
      maxObservationWindowHours: maxHours,
    })
    // Either a truly exact clock or rejecting nonzero submillisecond precision
    // is safe. Millisecond truncation returning claimable money is not safe.
    assert.equal(result.claimable, false)
    assert.equal(result.comparison.claimable, false)
    assert.equal(result.comparison.outcome, 'unknown')
    assert.equal(result.comparison.deltaCents, null)
    assert.equal(result.comparison.savingsCents, null)
    assert.deepEqual(result.comparison.lineDeltas, [])
    assert.ok(result.reasons.length > 0)
  })
}

for (const [label, first, second, maxHours] of [
  ['exact 15 minutes with 9-digit trailing zeros',
    '2026-10-02T10:00:00.123000000Z',
    '2026-10-02T10:15:00.123000000Z', 0.25],
  ['exact 24 hours through DST with 9-digit trailing zeros',
    '2026-03-28T17:00:00.000000000+01:00',
    '2026-03-29T18:00:00.000000000+02:00', 24],
]) {
  test(`M3 precision positive: ${label} remains claimable`, () => {
    assert.equal(exactNs(second) - exactNs(first),
      BigInt(Math.round(maxHours * 3600)) * 1_000_000_000n)
    const result = assessWeeklyBasketStudy(studyAt(first, second), {
      maxObservationWindowHours: maxHours,
    })
    assert.equal(result.claimable, true)
    assert.equal(result.comparison.claimable, true)
    assert.deepEqual(result.reasons, [])
  })
}

test('M3 precision positive: an actual 1ms overrun already fails closed', () => {
  const first = '2026-10-02T10:00:00.123Z'
  const second = '2026-10-02T10:15:00.124Z'
  assert.equal(exactNs(second) - exactNs(first), 900_001_000_000n)
  const result = assessWeeklyBasketStudy(studyAt(first, second), {
    maxObservationWindowHours: 0.25,
  })
  assert.equal(result.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.comparison.deltaCents, null)
  assert.equal(result.comparison.savingsCents, null)
})
