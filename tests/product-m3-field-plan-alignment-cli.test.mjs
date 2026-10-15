import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { m2DefaultActiveDays, m2InitialPlan } from '../src/data/m2Fixture.ts'
import { m3StudyWeekAlignment, main } from '../scripts/m3-field-plan-alignment.mjs'

const executable = fileURLToPath(new URL('../scripts/m3-field-plan-alignment.mjs', import.meta.url))
const originalPlan = structuredClone(m2InitialPlan)

function runCli(args) {
  const execution = spawnSync(process.execPath, [
    '--experimental-strip-types', executable, ...args,
  ], { encoding: 'utf8', timeout: 15_000, maxBuffer: 512 * 1024 })
  assert.ifError(execution.error)
  return execution
}

test('M3 fixed-field preflight accepts canonical default fixture without creating field evidence', () => {
  const summary = m3StudyWeekAlignment()
  assert.equal(summary.fixedStudyWeekMatches, true)
  assert.equal(summary.matchesFixedWorksheetDemand, true)
  assert.deepEqual(summary.selectedDays, m2DefaultActiveDays)
  assert.deepEqual(summary.missingDays, [])
  assert.deepEqual(summary.changedRecipes, [])
  assert.equal(summary.physicalStudyIngredientsPerStore, 11)
  assert.deepEqual(summary.storesToObserve, ['PLUS', 'DekaMarkt'])
  assert.equal(summary.evidenceStatus, 'preflight-only-not-an-observation')
  assert.equal(summary.retailerReusePermissionVerified, false)
  assert.equal(summary.fieldObservationEvidenceCollected, false)
  assert.equal(summary.publicSavingsClaimEligible, false)
  assert.equal(summary.liveRetailerRequests, 0)
  assert.deepEqual(m2InitialPlan, originalPlan)
})

test('M3 accepts reordered full day selection and explicit identical 4-meal recipe plan', () => {
  for (const args of [
    ['--days', 'Do,Wo,Di,Ma'],
    ['--plan', 'Wo:pasta,Ma:tikka,Do:tikka,Di:teriyaki'],
  ]) {
    const summary = m3StudyWeekAlignment(args)
    assert.equal(summary.fixedStudyWeekMatches, true)
    assert.deepEqual(summary.missingDays, [])
    assert.deepEqual(summary.changedRecipes, [])
    const output = []
    assert.equal(main(args, x => output.push(x)), 0)
    assert.deepEqual(JSON.parse(output.join('')), summary)
  }
})

test('M3 refuses a sparse field week with honest missing-day reasons and no fake observations', () => {
  const summary = m3StudyWeekAlignment(['--days', 'Ma,Do'])
  assert.equal(summary.fixedStudyWeekMatches, false)
  assert.equal(summary.matchesFixedWorksheetDemand, false)
  assert.deepEqual(summary.missingDays, ['Di', 'Wo'])
  assert.deepEqual(summary.changedRecipes, [])
  assert.match(summary.operatorInstruction, /Stop:/)
  assert.equal(summary.publicSavingsClaimEligible, false)
  assert.equal(summary.liveRetailerRequests, 0)
})

test('M3 rejects changed recipe even when a complete four-day plan is selected', () => {
  const summary = m3StudyWeekAlignment([
    '--plan', 'Ma:pasta,Di:teriyaki,Wo:pasta,Do:tikka',
  ])
  assert.equal(summary.fixedStudyWeekMatches, false)
  assert.deepEqual(summary.missingDays, [])
  assert.deepEqual(summary.changedRecipes, [
    { day: 'Ma', studyRecipeId: 'tikka', selectedRecipeId: 'pasta' },
  ])
  assert.equal(summary.evidenceStatus, 'preflight-only-not-an-observation')
})

test('M3 actual Node CLI returns 0 for canonical, 3 for mismatch, 2 for invalid input', () => {
  const normal = runCli([])
  assert.equal(normal.status, 0)
  assert.deepEqual(JSON.parse(normal.stdout).missingDays, [])
  assert.equal(normal.stderr, '')

  const mismatch = runCli(['--days', 'Ma'])
  assert.equal(mismatch.status, 3)
  const refusal = JSON.parse(mismatch.stdout)
  assert.equal(refusal.fixedStudyWeekMatches, false)
  assert.deepEqual(refusal.missingDays, ['Di', 'Wo', 'Do'])
  assert.equal(refusal.publicSavingsClaimEligible, false)
  assert.equal(mismatch.stderr, '')

  const altered = runCli(['--plan', 'Ma:pasta,Di:teriyaki,Wo:pasta,Do:tikka'])
  assert.equal(altered.status, 3)
  assert.deepEqual(JSON.parse(altered.stdout).changedRecipes.map(row => row.day), ['Ma'])

  const invalid = runCli(['--plan', 'Ma:<private-unknown-token>'])
  assert.equal(invalid.status, 2)
  assert.equal(invalid.stdout, '')
  assert.doesNotMatch(invalid.stderr, /private-unknown-token/)
  assert.match(invalid.stderr, /Ongeldige M3 voorcontrole/)
})

test('M3 rejects duplicate, unknown and extra flag tokens without leaking their contents', () => {
  for (const args of [
    ['--days', 'Ma,Ma'],
    ['--plan', 'Ma:unapproved'],
    ['--days', 'Ma', '--output', '/tmp/private-study.json'],
    ['--plan', 'Ma:tikka,Ma:pasta'],
  ]) {
    const result = runCli(args)
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '')
    assert.doesNotMatch(result.stderr, /\/tmp\/|unapproved|private-study/)
  }
  assert.deepEqual(m2InitialPlan, originalPlan)
})
