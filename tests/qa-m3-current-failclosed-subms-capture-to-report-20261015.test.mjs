import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'
import {
  observationSheetReadiness, observationWindowSummary,
} from '../src/domain/m3ObservationSheet.ts'
import { observationNextAction } from '../src/features/observation/observationNextStep.ts'

// Current acceptance contract: reject ambiguous nonzero nanosecond fractions
// *before* building a private report. Only fictional 11+11 rows, no shopper,
// actual retailer prices, receipts or consent/usage permissions.
const FIRST='2025-10-26T02:30:00.000000000+02:00'
const LAST='2025-10-27T01:30:00.000000000+01:00'
const CLOCK=Date.parse('2026-10-14T12:00:00Z')

function sheet(first=FIRST,last=LAST) {
  const value=buildFictionalPricedSheet(90)
  value.study.weekStart='2025-10-27'
  value.baseline.observedAt=first
  value.candidate.observedAt=last
  return value
}
function assertNeverFinancial(result) {
  assert.equal(result.claimable,false)
  assert.equal(result.comparison.claimable,false)
  assert.equal(result.comparison.outcome,'unknown')
  assert.equal(result.comparison.savingsCents,null)
  assert.equal(result.comparison.deltaCents,null)
  assert.deepEqual(result.comparison.lineDeltas,[])
}

test('valid exact 24h with trailing zero nanoseconds and DST offsets remains privately comparable',()=>{
  const valid=sheet()
  const before=JSON.stringify(valid)
  assert.equal(observationWindowSummary(valid,CLOCK).state,'within-window')
  assert.deepEqual(observationSheetReadiness(valid,CLOCK),{ready:true,issues:[]})
  assert.equal(observationNextAction(valid,CLOCK).stage,'export')
  const study=buildWeeklyBasketStudyFromObservationSheet(valid)
  assert.equal(study.baseline.basket.matchedLineCount,11)
  assert.equal(study.candidate.basket.matchedLineCount,11)
  const report=buildObservedWeekReport(study)
  assert.equal(report.publicSavingsClaimEligible,false)
  assert.equal(report.claimable,true,
    'Mathematical fictional study only, NEVER genuine retail proof')
  assert.equal(report.outcome,'better')
  assert.equal(JSON.stringify(valid),before)
})

for(const [label,first,last,side] of [
  ['+1ns candidate',FIRST,'2025-10-27T01:30:00.000000001+01:00','candidate'],
  ['+900us candidate',FIRST,'2025-10-27T01:30:00.000900000+01:00','candidate'],
  ['+1ns baseline','2025-10-26T02:30:00.000000001+02:00',LAST,'baseline'],
]){
  test('nonzero submillisecond '+label+' is blocked at collector, converter and direct assessment',()=>{
    const value=sheet(first,last)
    const before=JSON.stringify(value)
    assert.equal(observationSheetReadiness(value,CLOCK).ready,false)
    assert.notEqual(observationWindowSummary(value,CLOCK).state,'within-window')
    assert.notEqual(observationNextAction(value,CLOCK).stage,'export')
    assert.throws(
      ()=>buildWeeklyBasketStudyFromObservationSheet(value),
      new RegExp(side+'\\.observedAt must be a valid timestamp'),
    )
    assert.equal(JSON.stringify(value),before,'Cannot rewrite fictional input')
    // The direct assessor is independently callable without converter;
    // an already valid canonical study with a corrupt observedAt must abstain.
    const study=buildWeeklyBasketStudyFromObservationSheet(sheet())
    study[side].observedAt=side==='baseline'?first:last
    assertNeverFinancial(assessWeeklyBasketStudy(study))
    const report=buildObservedWeekReport(study)
    assert.equal(report.claimable,false)
    assert.equal(report.publicSavingsClaimEligible,false)
    assert.equal(report.savingsCents,null)
    assert.equal(report.outcome,'unknown')
  })
}

test('real private converter CLI refuses +1ns and +900us without publishing output',()=>{
  const dir=mkdtempSync(join(tmpdir(),'supa-precision-current-qa-'))
  try {
    for(const [i,end] of [
      '2025-10-27T01:30:00.000000001+01:00',
      '2025-10-27T01:30:00.000900000+01:00',
    ].entries()) {
      const input=join(dir,'fictional-input-'+i+'.json')
      const output=join(dir,'must-not-exist-'+i+'.json')
      const value=sheet(FIRST,end)
      value.study.participantKey='private-sentinel-cannot-leak'
      writeFileSync(input,JSON.stringify(value),{mode:0o600})
      const run=spawnSync(process.execPath,[
        '--experimental-strip-types','scripts/m3-build-observed-study.mjs',
        input,'--output',output,
      ],{cwd:process.cwd(),encoding:'utf8',timeout:30000})
      assert.equal(run.status,1,run.stderr)
      assert.equal(run.stdout,'')
      assert.equal(existsSync(output),false,
        'No canonical report must exist when ambiguous time was rejected')
      assert.doesNotMatch(run.stderr,/private-sentinel-cannot-leak|fictional-input-/)
    }
  } finally {
    rmSync(dir,{recursive:true,force:true})
  }
})
