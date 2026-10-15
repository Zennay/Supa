import test from 'node:test'
import assert from 'node:assert/strict'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { createPrivateM3StudyCodePin } from '../scripts/m3-field-code-pin.mjs'
import { preflightPrivateM3Week } from '../scripts/m3-verify-private-week-preflight.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

// QA-only, synthetic canonical 11x2 study. No human participant/price evidence or retailer I/O.
const SOURCE_SHA = '1234567890abcdef1234567890abcdef12345678'
const demand = buildObservationSheet()
function observed(which, timestamp) {
  return {
    evidenceId: 'fictional-' + which,
    observedAt: timestamp,
    source: 'manual-cart',
    provenanceNote: 'no real retailer observations',
    basket: {
      store: which === 'baseline'
        ? { id: 'plus-local', name: 'PLUS' }
        : { id: 'deka-local', name: 'DekaMarkt' },
      selectedMealCount: demand.selectedMealCount,
      lines: demand.requirements.map((item) => ({
        id: item.id, ingredientLabel: item.label,
        requirement: { amount: item.amount, unit: item.unit },
        status: 'unresolved', reasons: ['synthetic no price'],
        matchScore: null,
      })),
      totalCents: 0, matchedLineCount: 0,
      unresolvedLineCount: demand.requirements.length,
    },
  }
}
function study() {
  return {
    schemaVersion: 1,
    studyId: 'synthetic-boundary-qa',
    participantKey: 'synthetic-pseudonym',
    population: 'fictional students',
    region: 'fictional region',
    weekStart: '2026-10-12',
    priceContext: 'in-store',
    baseline: observed('baseline', '2026-10-14T11:00:00Z'),
    candidate: observed('candidate', '2026-10-14T12:00:00Z'),
  }
}
function check(value) {
  const bytes = Buffer.from(JSON.stringify(value))
  const pinned = Buffer.from(JSON.stringify(createPrivateM3StudyCodePin(bytes, SOURCE_SHA)))
  return preflightPrivateM3Week(bytes, pinned, SOURCE_SHA)
}
function reject(value) {
  assert.throws(() => check(value), /M3 private study provenance preflight refused/)
}

test('M3 private week accepts canonical unresolved 11x2 without granting financial rights', () => {
  const canonical = study()
  const result = check(canonical)
  assert.equal(result.status, 'private-review-only')
  assert.equal(result.privateStudyBytesMatch, true)
  assert.equal(result.canonicalDemandLineCount, 11)
  assert.equal(result.sameDemandLineCount, 11)
  assert.equal(result.sourceCommitShaAuthenticated, false)
  assert.equal(result.codeRevisionVerified, false)
  assert.equal(result.retailerPermissionVerified, false)
  assert.equal(result.publicSavingsClaimEligible, false)
})

test('M3 code-pin creator already blocks unsupported integer schema versions before preflight', () => {
  for (const version of [0, 2]) {
    const bogus = study()
    bogus.schemaVersion = version
    assert.match(buildObservedWeekReport(bogus).reasons.join(' '), /unsupported study schema version/)
    assert.throws(() => check(bogus), /Invalid private M3 study code-pin input/)
  }
})

test('M3 private week must refuse invisible-only student population metadata', () => {
  const bogus = study()
  bogus.population = '\u200B' // zero-width space, passes ordinary JS .trim()
  assert.equal(bogus.population.trim().length > 0, true)
  assert.match(buildObservedWeekReport(bogus).reasons.join(' '), /population is required/)
  reject(bogus)
})

test('M3 private week must refuse invisible-only region metadata', () => {
  const bogus = study()
  bogus.region = '\u200B' // zero-width space
  assert.equal(bogus.region.trim().length > 0, true)
  assert.match(buildObservedWeekReport(bogus).reasons.join(' '), /region is required/)
  reject(bogus)
})
