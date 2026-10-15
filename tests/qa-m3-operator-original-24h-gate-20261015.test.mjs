import test from 'node:test'
import assert from 'node:assert/strict'
import { buildObservationSheet, restoreObservationSheetDraft } from '../src/domain/m3ObservationSheet.ts'
import { reviewPrivateM3FieldSheet } from '../scripts/m3-private-field-readiness.mjs'

// Independent M3 offline, synthetic 11 PLUS + 11 DekaMarkt rows (all unavailable).
const SHA='abcdef1234567890abcdef1234567890abcdef12'
function full() {
  const s=buildObservationSheet()
  Object.assign(s.study,{
    studyId:'qa-private-week-proof',participantKey:'qa-fictional-only',
    population:'fictional students',region:'fictional region',
    weekStart:'2026-10-12',priceContext:'in-store',
  })
  for(const [side,clock,brand] of [
    ['baseline','2026-10-14T10:00:00Z','PLUS'],
    ['candidate','2026-10-15T10:00:00Z','DekaMarkt'],
  ]) {
    const p=s[side]
    p.evidenceId='synthetic-'+side
    p.observedAt=clock
    p.source='manual-cart'
    p.provenanceNote='entirely invented observation'
    p.store.id='fictional-'+side
    p.store.name=brand
    for(const line of p.lines)line.observedProduct.available=false
  }
  return s
}
const bytes=(v)=>Buffer.from(JSON.stringify(v))
const evaluate=(v)=>reviewPrivateM3FieldSheet(bytes(v),SHA)
function rejects(v) {
  assert.throws(()=>evaluate(v),(error)=>
    error instanceof Error && error.message==='Private M3 field readiness refused')
}
function noClaim(x) {
  assert.equal(x.technicalStudyConversionPossible,true)
  assert.equal(x.baselineUnresolvedLineCount,11)
  assert.equal(x.candidateUnresolvedLineCount,11)
  for(const field of [
    'fieldObservationVerified','sourceCommitShaAuthenticated',
    'codeRevisionVerified','retailerPermissionVerified','publicSavingsClaimEligible',
  ])assert.equal(x[field],false)
  assert.doesNotMatch(JSON.stringify(x),/qa-fictional-only|entirely invented|priceCents|sourceUrl/)
}

test('original 24h M3 capture exactly on boundary is technically convertible but not claimable',()=>{
  const x=full()
  assert.equal(x.study.maxObservationWindowHours,24)
  noClaim(evaluate(x))
})

test('original 24h M3 capture +1ms cannot be normalized into a private approved conversion',()=>{
  const x=full()
  x.candidate.observedAt='2026-10-15T10:00:00.001Z'
  rejects(x)
})

test('original 24h M3 capture +1ns cannot be rounded into apparent compliance',()=>{
  const x=full()
  x.candidate.observedAt='2026-10-15T10:00:00.000000001Z'
  rejects(x)
})

test('original 24h M3 window tampering is refused even if draft restore resets it to 24',()=>{
  for(const forged of [120,null,'24',24.001,0,-1]) {
    const x=full()
    x.study.maxObservationWindowHours=forged
    const normalized=restoreObservationSheetDraft(JSON.stringify(x))
    assert.ok(normalized)
    assert.equal(normalized.study.maxObservationWindowHours,24)
    rejects(x)
  }
})

test('missing original M3 24h cap is not interpreted as a valid inherited default',()=>{
  const x=full()
  delete x.study.maxObservationWindowHours
  assert.equal(restoreObservationSheetDraft(JSON.stringify(x)).study.maxObservationWindowHours,24)
  rejects(x)
})
