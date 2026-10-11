import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationSheetReadiness,
  observationWindowSummary,
} from '../src/domain/m3ObservationSheet.ts'

// Controlled synthetic collector metadata, NOT human PLUS/DekaMarkt observations.
// Mark all lines explicitly unavailable to exercise metadata + time gating
// without inventing a price, real source, or public savings eligibility.
function completedSyntheticSheet(baselineAt, candidateAt) {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa-collector-time-20261011',
    participantKey: 'synthetic-participant',
    population: 'synthetic-regression',
    region: 'synthetic-region',
    weekStart: '2026-10-19',
    priceContext: 'in-store',
  })
  for (const [side, id, storeName, observedAt] of [
    ['baseline', 'plus-qa', 'PLUS', baselineAt],
    ['candidate', 'dekamarkt-qa', 'DekaMarkt', candidateAt],
  ]) {
    Object.assign(sheet[side], {
      evidenceId: id,
      observedAt,
      provenanceNote: 'SYNTHETIC QA ONLY - no field visit or retailer prices',
      store: { id, name: storeName },
    })
    for (const line of sheet[side].lines) {
      line.observedProduct.available = false
    }
  }
  return sheet
}

// Independent exact-nanosecond clock oracle: Date.parse is used ONLY for
// whole-second + UTC offset, NEVER to measure fractional seconds.
function exactUtcNanoseconds(iso) {
  const match = /^(.*:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(iso)
  assert.ok(match, 'timestamp must be a full ISO instant')
  const wholeMilliseconds = Date.parse(match[1] + match[3])
  assert.ok(Number.isFinite(wholeMilliseconds))
  const subsecond = BigInt((match[2] ?? '').padEnd(9, '0'))
  return BigInt(wholeMilliseconds) * 1_000_000n + subsecond
}

const HOUR_24_NS = 86_400_000_000_000n

test('QA collector oracle independently distinguishes exact 24h from 24h+1ns and DST offset changes', () => {
  const samplePairs = [
    ['2026-10-24T15:00:00.000000000Z', '2026-10-25T15:00:00.000000000Z', HOUR_24_NS],
    ['2026-10-24T15:00:00.000000000Z', '2026-10-25T15:00:00.000000001Z', HOUR_24_NS + 1n],
    ['2026-10-24T17:00:00.000000000+02:00', '2026-10-25T16:00:00.000000001+01:00', HOUR_24_NS + 1n],
    ['2026-10-24T15:00:00.000000001Z', '2026-10-25T15:00:00.000000000Z', HOUR_24_NS - 1n],
  ]
  for (const [first, second, expected] of samplePairs) {
    assert.equal(exactUtcNanoseconds(second) - exactUtcNanoseconds(first), expected)
  }
})

const outOfWindowSubmillisecondPairs = [
  {
    label: 'candidate +1ns after strict UTC 24h boundary',
    first: '2026-10-24T15:00:00.000000000Z',
    second: '2026-10-25T15:00:00.000000001Z',
  },
  {
    label: 'baseline +1ns in reversed observation order',
    first: '2026-10-25T15:00:00.000000001Z',
    second: '2026-10-24T15:00:00.000000000Z',
  },
  {
    label: 'DST +02 to +01 elapsed 24h+1ns, not wall time',
    first: '2026-10-24T17:00:00.000000000+02:00',
    second: '2026-10-25T16:00:00.000000001+01:00',
  },
]

for (const { label, first, second } of outOfWindowSubmillisecondPairs) {
  test(`QA collector expected RED: ${label} must not signal an eligible field window`, () => {
    const elapsed = exactUtcNanoseconds(second) - exactUtcNanoseconds(first)
    assert.equal(elapsed < 0n ? -elapsed : elapsed, HOUR_24_NS + 1n)
    const sheet = completedSyntheticSheet(first, second)
    const window = observationWindowSummary(sheet)
    const readiness = observationSheetReadiness(sheet)

    // Two independent product-facing boundaries must agree: deadline
    // presentation and export-ready guidance. The current Date.parse
    // millisecond path is expected to FAIL these safety assertions.
    assert.equal(window.state, 'outside-window')
    assert.equal(readiness.ready, false)
    assert.match(readiness.issues.join(' '), /24|uur|observat/i)
  })
}

const acceptedPairs = [
  ['exact 24h in zero-padded 9-digit precision', '2026-10-24T15:00:00.000000000Z', '2026-10-25T15:00:00.000000000Z'],
  ['strictly within 24h by 1ns', '2026-10-24T15:00:00.000000001Z', '2026-10-25T15:00:00.000000000Z'],
  ['exact 24h over DST offset change', '2026-10-24T17:00:00.000000000+02:00', '2026-10-25T16:00:00.000000000+01:00'],
]

for (const [label, first, second] of acceptedPairs) {
  test(`QA collector positive: ${label} retains within-window status`, () => {
    const sheet = completedSyntheticSheet(first, second)
    const elapsed = exactUtcNanoseconds(second) - exactUtcNanoseconds(first)
    assert.ok(elapsed >= 0n && elapsed <= HOUR_24_NS)
    assert.equal(observationWindowSummary(sheet).state, 'within-window')
    assert.equal(observationSheetReadiness(sheet).ready, true)
  })
}

test('QA collector positive: +1ms remains outside 24h (existing supported resolution)', () => {
  const sheet = completedSyntheticSheet(
    '2026-10-24T15:00:00.000Z',
    '2026-10-25T15:00:00.001Z',
  )
  assert.equal(observationWindowSummary(sheet).state, 'outside-window')
  const result = observationSheetReadiness(sheet)
  assert.equal(result.ready, false)
  assert.match(result.issues.join(' '), /24|uur|observat/i)
})
