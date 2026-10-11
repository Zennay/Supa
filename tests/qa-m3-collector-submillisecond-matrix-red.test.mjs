import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationSheetReadiness,
  observationWindowSummary,
} from '../src/domain/m3ObservationSheet.ts'

// Independent QA for #1513: Date.parse truncation hides violations smaller
// than one millisecond. Synthetic observations, no prices or store visit.
const DAY_NS = 86_400_000_000_000n

function utcNanoseconds(value) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  assert.ok(match, 'test fixture is an explicit ISO instant')
  const secondEpoch = Date.parse(match[1] + match[3])
  assert.ok(Number.isFinite(secondEpoch))
  return BigInt(secondEpoch) * 1_000_000n +
    BigInt((match[2] ?? '').padEnd(9, '0'))
}

function completeWithoutInventedPrices(first, second) {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'synthetic-qa-submillisecond-matrix',
    participantKey: 'anonymous-synthetic-test-only',
    population: 'synthetic',
    region: 'synthetic',
    weekStart: '2026-10-19',
    priceContext: 'in-store',
  })
  for (const [side, observedAt, storeId, storeName] of [
    ['baseline', first, 'qa-plus-id', 'PLUS'],
    ['candidate', second, 'qa-dekamarkt-id', 'DekaMarkt'],
  ]) {
    Object.assign(sheet[side], {
      evidenceId: 'synthetic-' + side,
      observedAt,
      provenanceNote: 'QA fixtures, not observed retailer evidence',
      store: { id: storeId, name: storeName },
    })
    for (const line of sheet[side].lines) {
      line.observedProduct.available = false
    }
  }
  return sheet
}

const cases = [
  {
    label: 'large 999,999ns breach after nonzero .123 millisecond',
    first: '2026-10-24T12:00:00.123000000Z',
    second: '2026-10-25T12:00:00.123999999Z',
  },
  {
    label: 'large 999,999ns breach before .999999999 second rollover',
    first: '2026-10-24T12:00:00.999000000Z',
    second: '2026-10-25T12:00:00.999999999Z',
  },
  {
    label: 'same submillisecond breach across October offset change',
    first: '2026-10-24T14:00:00.500000000+02:00',
    second: '2026-10-25T13:00:00.500999999+01:00',
  },
  {
    label: 'reversed collection chronology at nonzero millisecond',
    first: '2026-10-25T12:00:00.456999999Z',
    second: '2026-10-24T12:00:00.456000000Z',
  },
]

for (const { label, first, second } of cases) {
  test('QA expected RED: collector rejects ' + label, () => {
    const nanos = utcNanoseconds(second) - utcNanoseconds(first)
    assert.equal(nanos < 0n ? -nanos : nanos, DAY_NS + 999_999n)
    // The millisecond implementation currently loses the violation.
    assert.equal(Math.abs(Date.parse(second) - Date.parse(first)), 86_400_000)

    const sheet = completeWithoutInventedPrices(first, second)
    const window = observationWindowSummary(sheet)
    const readiness = observationSheetReadiness(sheet)
    assert.equal(window.state, 'outside-window')
    assert.equal(readiness.ready, false)
    assert.match(readiness.issues.join(' '), /24|uur|observat/i)
  })
}

test('QA positive: exactly 24h with supported .123000000 millisecond formatting stays eligible', () => {
  const first = '2026-10-24T12:00:00.123000000Z'
  const second = '2026-10-25T12:00:00.123000000Z'
  assert.equal(utcNanoseconds(second) - utcNanoseconds(first), DAY_NS)
  const sheet = completeWithoutInventedPrices(first, second)
  assert.equal(observationWindowSummary(sheet).state, 'within-window')
  assert.equal(observationSheetReadiness(sheet).ready, true)
})

test('QA positive: .123 millisecond plus one complete millisecond still fails', () => {
  const first = '2026-10-24T12:00:00.123000000Z'
  const second = '2026-10-25T12:00:00.124000000Z'
  assert.equal(utcNanoseconds(second) - utcNanoseconds(first), DAY_NS + 1_000_000n)
  const sheet = completeWithoutInventedPrices(first, second)
  assert.equal(observationWindowSummary(sheet).state, 'outside-window')
  assert.equal(observationSheetReadiness(sheet).ready, false)
})
