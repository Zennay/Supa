import assert from 'node:assert/strict'
import test from 'node:test'

import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

// End-to-end #78 M3 contract: canonical blank sheet -> controlled completed
// observation sheet -> canonical converter -> privacy-safe assessment.
// Prices here are invented *test fixtures*, never store observations.
function completeSyntheticSheet(baselineAt, candidateAt) {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa-converter-window-2026',
    participantKey: 'synthetic-private-key',
    population: 'synthetic only',
    region: 'Leiden',
    weekStart: '2026-10-19',
    priceContext: 'in-store',
  })
  for (const [side, store, offset] of [
    ['baseline', { id: 'qa-plus', name: 'PLUS synthetic' }, 10],
    ['candidate', { id: 'qa-deka', name: 'DekaMarkt synthetic' }, 0],
  ]) {
    const observation = sheet[side]
    observation.evidenceId = `${side}-synthetic-001`
    observation.observedAt = side === 'baseline' ? baselineAt : candidateAt
    observation.source = 'manual-cart'
    observation.provenanceNote = 'Test-only generated product data; not a retailer observation'
    observation.store = store
    observation.lines.forEach((line, index) => {
      const requirement = sheet.requirements[index]
      line.observedProduct = {
        productId: `${side}-${requirement.id}`,
        productName: requirement.query,
        packAmount: requirement.amount,
        packUnit: requirement.unit,
        packCount: 1,
        priceCents: 100 + index + offset,
        available: true,
        sourceUrl: '',
        note: 'Synthetic test fixture only',
      }
    })
  }
  return sheet
}

function runFullRoute(baselineAt, candidateAt) {
  const sheet = completeSyntheticSheet(baselineAt, candidateAt)
  const originalSheet = JSON.stringify(sheet)
  const study = buildWeeklyBasketStudyFromObservationSheet(
    JSON.parse(JSON.stringify(sheet)),
  )
  const transport = JSON.parse(JSON.stringify(study))
  const report = buildObservedWeekReport(transport)

  assert.equal(study.baseline.basket.matchedLineCount, 11)
  assert.equal(study.candidate.basket.matchedLineCount, 11)
  assert.equal(study.baseline.basket.unresolvedLineCount, 0)
  assert.equal(study.candidate.basket.unresolvedLineCount, 0)
  assert.equal(JSON.stringify(sheet), originalSheet)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal('participantKey' in report, false)
  assert.doesNotMatch(JSON.stringify(report), /synthetic-private-key/)
  return { report, study }
}

test('M3 sheet-to-converter-to-report accepts exact 24h elapsed despite DST', () => {
  const { report, study } = runFullRoute(
    '2026-10-24T18:00:00+02:00',
    '2026-10-25T17:00:00+01:00',
  )
  assert.equal(report.observationWindowHours, 24)
  assert.equal(report.claimable, true)
  assert.equal(report.outcome, 'better')
  assert.equal(report.deltaCents, study.candidate.basket.totalCents - study.baseline.basket.totalCents)
  assert.equal(report.savingsCents, -report.deltaCents)
})

test('M3 converter output cannot turn an over-24h synthetic sheet into savings', () => {
  const { report } = runFullRoute(
    '2026-10-24T18:00:00.000+02:00',
    '2026-10-25T17:00:00.001+01:00',
  )
  assert.ok(report.observationWindowHours > 24)
  assert.equal(report.claimable, false)
  assert.equal(report.outcome, 'unknown')
  assert.equal(report.deltaCents, null)
  assert.equal(report.savingsCents, null)
  assert.equal(report.attribution.status, 'unknown')
  assert.match(report.reasons.join(' '), /max is 24h/)
})

test('M3 complete converter route preserves a worse basket at sub-24h', () => {
  const sheet = completeSyntheticSheet(
    '2026-10-24T16:00:00Z',
    '2026-10-25T15:59:59.999Z',
  )
  for (const line of sheet.candidate.lines) line.observedProduct.priceCents += 20
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const report = buildObservedWeekReport(study)
  assert.ok(report.observationWindowHours < 24)
  assert.equal(report.claimable, true)
  assert.equal(report.outcome, 'worse')
  assert.ok(report.deltaCents > 0)
  assert.equal(report.savingsCents, -report.deltaCents)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal('participantKey' in report, false)
})

test('M3 canonical converter rejects attempts to widen the 24-hour field contract', () => {
  for (const bypass of [48, 24.0001, Number.POSITIVE_INFINITY, '24', null]) {
    const sheet = completeSyntheticSheet(
      '2026-10-24T16:00:00Z',
      '2026-10-26T16:00:00Z',
    )
    sheet.study.maxObservationWindowHours = bypass
    assert.throws(
      () => buildWeeklyBasketStudyFromObservationSheet(sheet),
      /maxObservationWindowHours must remain 24/,
    )
  }
})

test('M3 observation template cannot be promoted to actual evidence by renaming its status', () => {
  const sheet = completeSyntheticSheet(
    '2026-10-24T16:00:00Z',
    '2026-10-25T16:00:00Z',
  )
  sheet.evidenceStatus = 'real-observation'
  assert.throws(
    () => buildWeeklyBasketStudyFromObservationSheet(sheet),
    /evidenceStatus must remain/,
  )
})

test('M3 identical evidence IDs across stores yield unknown, never a savings claim', () => {
  const sheet = completeSyntheticSheet(
    '2026-10-24T16:00:00Z',
    '2026-10-25T15:00:00Z',
  )
  sheet.candidate.evidenceId = sheet.baseline.evidenceId
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const report = buildObservedWeekReport(study)
  assert.equal(report.claimable, false)
  assert.equal(report.outcome, 'unknown')
  assert.equal(report.deltaCents, null)
  assert.equal(report.savingsCents, null)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.match(report.reasons.join(' '), /evidence IDs must differ/)
})
