import test from 'node:test'
import assert from 'node:assert/strict'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { reviewPrivateM3FieldSheet } from '../scripts/m3-private-field-readiness.mjs'

// Independent QA-only. No genuine shopper data, network, reusable retailer facts or prices.
const SHA = '1234567890abcdef1234567890abcdef12345678'
const data = (value) => Buffer.from(JSON.stringify(value))
function study() {
  const s=buildObservationSheet()
  Object.assign(s.study,{
    studyId:'synthetic-check-qa',participantKey:'fictional-key',
    population:'fictional student cohort',region:'fictional location',
    weekStart:'2026-10-12',priceContext:'in-store',
  })
  for(const [side,time,storeName] of [
    ['baseline','2026-10-14T10:00:00Z','PLUS'],
    ['candidate','2026-10-14T11:00:00Z','DekaMarkt'],
  ]) {
    const p=s[side]
    p.evidenceId='synthetic-'+side
    p.observedAt=time
    p.source='manual-cart'
    p.provenanceNote='fictional handwritten evidence'
    p.store.id='fictional-'+side
    p.store.name=storeName
    for(const line of p.lines)line.observedProduct.available=false
  }
  return s
}
function check(s){ return reviewPrivateM3FieldSheet(data(s),SHA) }
function assertSafe(r) {
  for (const field of [
    'fieldObservationVerified','sourceCommitShaAuthenticated',
    'codeRevisionVerified','retailerPermissionVerified','publicSavingsClaimEligible',
  ])assert.equal(r[field],false,field)
  const serialized=JSON.stringify(r)
  assert.doesNotMatch(serialized,/fictional-key|handwritten evidence|fictional student|sourceUrl|productName|priceCents/)
  assert.equal(Object.isFrozen(r),true)
}

test('M3 independent operator check on completed 22x fictional unavailable observations remains private', () => {
  const x=check(study())
  assert.equal(x.status,'private-tooling-only')
  assert.equal(x.canonicalLineCount,22)
  assert.equal(x.plusCompleteLineCount,11)
  assert.equal(x.dekamarktCompleteLineCount,11)
  assert.equal(x.plusAvailabilityRecorded,11)
  assert.equal(x.dekamarktAvailabilityRecorded,11)
  assert.equal(x.technicalStudyConversionPossible,true)
  assert.equal(x.baselineUnresolvedLineCount,11)
  assert.equal(x.candidateUnresolvedLineCount,11)
  assert.equal(x.nextAction,'review-unavailable-or-unmatched-products')
  assertSafe(x)
})

test('M3 private operator guidance names PLUS first when both stores lack data', () => {
  const x=study()
  x.baseline.lines[0].observedProduct.available=null
  x.candidate.lines[1].observedProduct.available=null
  const out=check(x)
  assert.equal(out.completeObservationLineCount,20)
  assert.equal(out.plusCompleteLineCount,10)
  assert.equal(out.dekamarktCompleteLineCount,10)
  assert.equal(out.nextAction,'complete-plus-observations')
  assert.equal(out.technicalStudyConversionPossible,false)
  assertSafe(out)
})

test('M3 private operator guidance switches to DekaMarkt only when PLUS is complete', () => {
  const x=study()
  x.candidate.lines[1].observedProduct.available=null
  const out=check(x)
  assert.equal(out.plusCompleteLineCount,11)
  assert.equal(out.dekamarktCompleteLineCount,10)
  assert.equal(out.nextAction,'complete-dekamarkt-observations')
  assert.equal(out.technicalStudyConversionPossible,false)
  assertSafe(out)
})

test('M3 progress does not treat zero-width-only source notes as completed metadata', () => {
  for (const side of ['baseline','candidate']) {
    const x=study()
    x[side].provenanceNote='\u200b'
    const out=check(x)
    assert.ok(out.metadataCompleteCount<out.metadataRequiredCount)
    assert.equal(out.technicalStudyConversionPossible,false)
    assert.equal(out.nextAction,'complete-private-study-metadata')
    assertSafe(out)
  }
})

test('M3 operator rejects contradictory raw JSON duplicate availability even when last value is safe', () => {
  const raw=data(study()).toString('utf8')
  const duplicate=raw.replace('"available":false','"available":true,"available":false')
  assert.notEqual(duplicate,raw)
  assert.equal(JSON.parse(duplicate).baseline.lines[0].observedProduct.available,false)
  assert.throws(() => reviewPrivateM3FieldSheet(Buffer.from(duplicate),SHA),/Private M3 field readiness refused/)
})

test('M3 expected source main SHA and private evidence flags must not be confused', () => {
  const full=data(study())
  assert.throws(()=>reviewPrivateM3FieldSheet(full,undefined),/readiness refused/)
  assert.throws(()=>reviewPrivateM3FieldSheet(full,'0'.repeat(40)),/readiness refused/)
  const positive=reviewPrivateM3FieldSheet(full,SHA)
  assertSafe(positive)
  assert.equal(positive.technicalStudyConversionPossible,true)
  assert.equal('sourceCommitSha' in positive,false)
})
