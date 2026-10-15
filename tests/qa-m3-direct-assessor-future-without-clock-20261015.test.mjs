import test from 'node:test'
import assert from 'node:assert/strict'

import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

// These are invented stores, products, amounts and prices. No human field
// observation, real retailer prices, receipts, permission or public savings.
function fictionalHistoricalStudy() {
  const sheet=buildObservationSheet()
  Object.assign(sheet.study,{
    studyId:'qa-clock-invariant-only',
    participantKey:'fictional-participant-no-person',
    population:'fictional-only',region:'fictional',
    weekStart:'2026-09-28',priceContext:'in-store',
  })
  for(const [side,name,id,extra,time] of [
    ['baseline','PLUS fictional','fake-plus',20,'2026-10-04T12:00:00Z'],
    ['candidate','DekaMarkt fictional','fake-deka',0,'2026-10-04T13:00:00Z'],
  ]){
    const observation=sheet[side]
    Object.assign(observation,{
      evidenceId:side+'-fictional',observedAt:time,source:'manual-cart',
      provenanceNote:'Synthetic trust-boundary QA only; no store visit',
      store:{id,name},
    })
    observation.lines.forEach((line,i)=>{
      const requirement=sheet.requirements[i]
      line.observedProduct={
        available:true,
        productId:id+'-'+requirement.id,
        productName:requirement.query,
        packAmount:requirement.amount,packUnit:requirement.unit,
        packCount:1,priceCents:120+i+extra,
        sourceUrl:'',note:'Fictional prices, no observation',
      }
    })
  }
  return buildWeeklyBasketStudyFromObservationSheet(sheet)
}

test('positive: historical fictional baskets remain comparable with explicit trusted runtime clock',()=>{
  const study=fictionalHistoricalStudy()
  const assessment=assessWeeklyBasketStudy(study,{referenceNowMs:Date.now()})
  assert.equal(assessment.comparison.outcome,'better')
  assert.equal(assessment.claimable,true,
    'Synthetic mathematical claimability only, NEVER public/field savings proof')
})

test('direct assessment without clock override must NOT approve two wholly future but 1h-apart baskets',()=>{
  const study=fictionalHistoricalStudy()
  study.weekStart='2099-10-09'
  study.baseline.observedAt='2099-10-10T12:00:00Z'
  study.candidate.observedAt='2099-10-10T13:00:00Z'
  // Both are in the declared shopping week and satisfy the <=24h rule;
  // the ONLY remaining difference from an authentic past pair is the
  // impossible future absolute observation time.
  const explicit=assessWeeklyBasketStudy(study,{referenceNowMs:Date.now()})
  assert.equal(explicit.claimable,false)
  assert.equal(explicit.comparison.outcome,'unknown')
  assert.equal(explicit.comparison.savingsCents,null)
  const report=buildObservedWeekReport(study)
  assert.equal(report.claimable,false)
  assert.equal(report.publicSavingsClaimEligible,false)
  assert.equal(report.savingsCents,null)
  // The direct exported API is callable without CLI; silently omitting a
  // clock option must not make future financial assertions eligible.
  const actual=assessWeeklyBasketStudy(study)
  assert.equal(actual.claimable,false,'No default-clock bypass for future fake money evidence')
  assert.equal(actual.comparison.claimable,false)
  assert.equal(actual.comparison.outcome,'unknown')
  assert.equal(actual.comparison.savingsCents,null)
  assert.equal(actual.comparison.deltaCents,null)
  assert.deepEqual(actual.comparison.lineDeltas,[])
  assert.doesNotMatch(JSON.stringify(actual),/fictional-participant-no-person/)
})
