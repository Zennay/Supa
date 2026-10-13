import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

import {
  buildObservationSheet,
  M3_EXPECTED_RETAILERS,
  withObservedProductAvailability,
} from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from './m3-build-observed-study.mjs'
import { buildObservedWeekReport } from './m3-assess-observed-week.mjs'

// Intentionally fictional, fixed inputs. Never read a human observation or a retailer source.
export function buildFictionalRehearsalSheet() {
  const sheet = buildObservationSheet()
  assert.equal(sheet.requirements.length, 11, 'M3 canonical demand changed: re-review field protocol')
  sheet.study = {
    ...sheet.study,
    studyId: 'fictional-rehearsal-only',
    participantKey: 'fictional-operator-key',
    population: 'fictional-students',
    region: 'fictional-region',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
  }

  for (const [side, timestamp] of [
    ['baseline', '2026-10-01T10:00:00Z'],
    ['candidate', '2026-10-01T10:15:00Z'],
  ]) {
    const observation = sheet[side]
    observation.evidenceId = `fictional-${side}-001`
    observation.observedAt = timestamp
    observation.provenanceNote = 'FICTIONAL TEST; NOT A STORE OBSERVATION'
    observation.store = {
      id: `fictional-${side}-store`,
      name: M3_EXPECTED_RETAILERS[side],
    }
    observation.lines = observation.lines.map((line) => ({
      ...line,
      // Explicitly observed-unavailable is a fictional negative control,
      // not the same as an unmeasured (null) human field.
      observedProduct: withObservedProductAvailability(line.observedProduct, false),
    }))
  }
  return sheet
}

// Fully priced fiction exercises the *positive* money path. Never print these
// values and never mislabel them as observed retailer prices.
export function buildFictionalPricedSheet(candidatePriceCents = 90) {
  assert.ok(Number.isSafeInteger(candidatePriceCents) && candidatePriceCents >= 0)
  const sheet = buildFictionalRehearsalSheet()
  for (const side of ['baseline', 'candidate']) {
    sheet[side].lines = sheet[side].lines.map((line, index) => ({
      ...line,
      observedProduct: {
        ...line.observedProduct,
        available: true,
        productId: `fictional-${side}-product-${index}`,
        productName: sheet.requirements[index].query,
        packAmount: line.requirement.amount,
        packUnit: line.requirement.unit,
        packCount: 1,
        priceCents: side === 'baseline' ? 100 : candidatePriceCents,
      },
    }))
  }
  return sheet
}

function evaluate(sheet) {
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  return buildObservedWeekReport(study)
}

export function rehearseM3FieldPipeline() {
  const sheet = buildFictionalRehearsalSheet()
  const originalSheet = JSON.stringify(sheet)
  const report = evaluate(sheet)

  for (const side of ['baseline', 'candidate']) {
    assert.equal(sheet[side].lines.length, 11)
    assert.equal(report[side].matchedLineCount, 0)
    assert.equal(report[side].unresolvedLineCount, 11)
    assert.equal(report[side].totalCents, 0)
  }
  assert.equal(JSON.stringify(sheet), originalSheet, 'converter mutated the input sheet')
  assert.equal(report.outcome, 'unknown')
  assert.equal(report.claimable, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.deltaCents, null)
  assert.equal(report.savingsCents, null)
  assert.equal(report.baselineTotalCents, 0)
  assert.equal(report.candidateTotalCents, 0)
  assert.equal(report.observationWindowHours, 0.25)

  // A fabricated stale price behind "unavailable" must never become money.
  const stalePriceSheet = buildFictionalRehearsalSheet()
  stalePriceSheet.baseline.lines[0].observedProduct.priceCents = 999999
  const stalePriceReport = evaluate(stalePriceSheet)
  assert.equal(stalePriceReport.savingsCents, null)
  assert.equal(stalePriceReport.baselineTotalCents, 0)
  assert.equal(stalePriceReport.publicSavingsClaimEligible, false)

  // "Not measured" must never pass for "observed unavailable".
  const unmeasuredSheet = buildFictionalRehearsalSheet()
  unmeasuredSheet.baseline.lines[0].observedProduct.available = null
  assert.throws(() => evaluate(unmeasuredSheet), /available must be true or false/)

  // Demand drift and retailer substitution must both fail closed.
  const driftSheet = buildFictionalRehearsalSheet()
  driftSheet.candidate.lines[0].requirement.amount += 1
  assert.throws(() => evaluate(driftSheet), /canonical planner demand/)
  const wrongRetailerSheet = buildFictionalRehearsalSheet()
  wrongRetailerSheet.baseline.store.name = 'Different store'
  assert.throws(() => evaluate(wrongRetailerSheet), /PLUS/)

  // Elapsed 24h is inclusive; 24h+1s is explicitly unclaimable.
  const boundarySheet = buildFictionalRehearsalSheet()
  boundarySheet.candidate.observedAt = '2026-10-02T10:00:00Z'
  const boundaryReport = evaluate(boundarySheet)
  assert.equal(boundaryReport.observationWindowHours, 24)
  assert.equal(boundaryReport.savingsCents, null)
  const expiredSheet = buildFictionalRehearsalSheet()
  expiredSheet.candidate.observedAt = '2026-10-02T10:00:01Z'
  const expiredReport = evaluate(expiredSheet)
  assert.ok(expiredReport.observationWindowHours > 24)
  assert.ok(expiredReport.reasons.some((reason) => reason.includes('max is 24h')))
  assert.equal(expiredReport.savingsCents, null)
  assert.equal(expiredReport.publicSavingsClaimEligible, false)

  // Full fictional matched baskets must exercise better/same/worse using the
  // real matcher, pack arithmetic, comparator and report, not mock totals.
  for (const [priceCents, outcome, privateSavingsCents] of [
    [90, 'better', 110],
    [100, 'same', 0],
    [110, 'worse', -110],
  ]) {
    const priced = buildFictionalPricedSheet(priceCents)
    const pricedReport = evaluate(priced)
    assert.equal(pricedReport.baseline.matchedLineCount, 11)
    assert.equal(pricedReport.candidate.matchedLineCount, 11)
    assert.equal(pricedReport.baselineTotalCents, 1100)
    assert.equal(pricedReport.candidateTotalCents, priceCents * 11)
    assert.equal(pricedReport.outcome, outcome)
    assert.equal(pricedReport.savingsCents, privateSavingsCents)
    assert.equal(pricedReport.publicSavingsClaimEligible, false)
  }

  // A complete fictional basket one second outside the window must lose the
  // otherwise calculable money outcome rather than retaining any savings.
  const expiredPriced = buildFictionalPricedSheet()
  expiredPriced.candidate.observedAt = '2026-10-02T10:00:01Z'
  const expiredPricedReport = evaluate(expiredPriced)
  assert.equal(expiredPricedReport.outcome, 'unknown')
  assert.equal(expiredPricedReport.savingsCents, null)
  assert.ok(expiredPricedReport.reasons.some((reason) => reason.includes('max is 24h')))

  // An incomplete but otherwise priced fictional basket must remain unknown.
  const partialPriced = buildFictionalPricedSheet()
  partialPriced.candidate.lines[0].observedProduct.available = false
  const partialReport = evaluate(partialPriced)
  assert.equal(partialReport.outcome, 'unknown')
  assert.equal(partialReport.savingsCents, null)
  assert.equal(partialReport.publicSavingsClaimEligible, false)

  // The sole public output is a fixed, non-sensitive summary. In particular,
  // do not emit sheet/report JSON, timestamps, retailer values or participant keys.
  return {
    kind: 'm3-field-pipeline-rehearsal',
    syntheticOnly: true,
    requirementPairsChecked: 11,\n    fictionalOutcomesVerified: ['better', 'same', 'worse', 'unknown'],
    negativeControlsPassed: 7,
    converterAndAssessorOperational: true,
    realRetailerEvidenceVerified: false,
    m3ExitProven: false,
    publicSavingsClaimEligible: false,
    m4BetaEligible: false,
  }
}

export function main(argv = process.argv.slice(2)) {
  assert.equal(argv.length, 0, 'rehearsal takes no input or output arguments')
  const result = rehearseM3FieldPipeline()
  process.stdout.write(`${JSON.stringify(result)}\n`)
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch {
    // Sanitized failure: never echo an input, path, private evidence or stack trace.
    process.stderr.write('M3 synthetic rehearsal failed; no field evidence was processed.\n')
    process.exitCode = 1
  }
}
