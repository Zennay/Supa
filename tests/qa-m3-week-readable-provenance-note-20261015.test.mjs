import test from 'node:test'
import assert from 'node:assert/strict'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { createPrivateM3StudyCodePin } from '../scripts/m3-field-code-pin.mjs'
import { preflightPrivateM3Week } from '../scripts/m3-verify-private-week-preflight.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

// Fully fictional/offline, deliberately unresolved 11+11 data, never real price proof.
const SHA = 'abcdef1234567890abcdef1234567890abcdef12'
const fixture = buildObservationSheet()
function example(side) {
  return {
    evidenceId: 'synthetic-' + side,
    observedAt: side === 'baseline' ? '2026-10-14T08:00:00Z' : '2026-10-14T08:30:00Z',
    source: 'manual-cart',
    provenanceNote: 'fictional paper observation only',
    basket: {
      store: side === 'baseline' ? {id: 'plus-local', name: 'PLUS'} :
        {id: 'deka-local', name: 'DekaMarkt'},
      selectedMealCount: fixture.selectedMealCount,
      lines: fixture.requirements.map(r => ({
        id:r.id, ingredientLabel:r.label, requirement:{amount:r.amount,unit:r.unit},
        status:'unresolved', reasons:['synthetic unknown'], matchScore:null,
      })),
      totalCents:0, matchedLineCount:0, unresolvedLineCount:fixture.requirements.length,
    },
  }
}
function study() {
  return {
    schemaVersion:1, studyId:'synthetic-source-note', participantKey:'synthetic-key',
    population:'synthetic people', region:'fictional city',
    weekStart:'2026-10-12', priceContext:'in-store',
    baseline:example('baseline'), candidate:example('candidate'),
  }
}
function check(studyInput) {
  const source=Buffer.from(JSON.stringify(studyInput))
  const manifest=Buffer.from(JSON.stringify(createPrivateM3StudyCodePin(source,SHA)))
  return preflightPrivateM3Week(source,manifest,SHA)
}

test('private M3 accepts an explicitly readable fictional note without publishing savings', () => {
  const v=check(study())
  assert.equal(v.status,'private-review-only')
  assert.equal(v.canonicalDemandLineCount,11)
  assert.equal(v.publicSavingsClaimEligible,false)
  assert.equal(v.retailerPermissionVerified,false)
  assert.equal(v.codeRevisionVerified,false)
  assert.equal(v.sourceCommitShaAuthenticated,false)
})

test('private M3 refuses zero-width-only baseline provenance despite byte-pinned canonical demand', () => {
  const sample=study()
  sample.baseline.provenanceNote='\u200b'
  assert.ok(sample.baseline.provenanceNote.trim().length>0)
  assert.match(buildObservedWeekReport(sample).reasons.join(' '),/baseline evidence provenance note is required/)
  assert.throws(()=>check(sample),/M3 private study provenance preflight refused/)
})

test('private M3 refuses zero-width-only candidate provenance despite valid timestamp and SHA', () => {
  const sample=study()
  sample.candidate.provenanceNote='\u200b'
  assert.ok(sample.candidate.provenanceNote.trim().length>0)
  assert.match(buildObservedWeekReport(sample).reasons.join(' '),/candidate evidence provenance note is required/)
  assert.throws(()=>check(sample),/M3 private study provenance preflight refused/)
})
