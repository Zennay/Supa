import assert from 'node:assert/strict'
import test from 'node:test'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { m2DefaultActiveDays, m2InitialPlan } from '../src/data/m2Fixture.ts'
import { m3FieldSheetMatchesPlannerWeek } from '../src/features/observation/m3PlannerMeasurementWeek.ts'
import { selectedFixtureWeek } from '../scripts/retailer-reviewed-custom-week.mjs'
import { m3StudyWeekAlignment } from '../scripts/m3-field-plan-alignment.mjs'

/**
 * Product-core composition proof: this test specifically checks the contract
 * shared by independently frozen reviewed-week, Planner UI, and M3 operator
 * source owners. No retailer HTTP, prices, participants or field observations.
 */
test('M3 integrated fixed week: planner, field preflight and both blank stores agree', () => {
  const initialFixture = JSON.stringify(m2InitialPlan)
  const blankSheetBefore = JSON.stringify(buildObservationSheet())
  const selected = selectedFixtureWeek([])
  const review = m3StudyWeekAlignment([])
  assert.deepEqual(selected.days, m2DefaultActiveDays)
  assert.equal(m3FieldSheetMatchesPlannerWeek(selected.plan, selected.days), true)
  assert.equal(review.matchesFixedWorksheetDemand, true)
  assert.equal(review.fixedStudyWeekMatches, true)
  assert.equal(review.physicalStudyIngredientsPerStore, 11)
  assert.deepEqual(review.storesToObserve, ['PLUS', 'DekaMarkt'])
  assert.equal(review.fieldObservationEvidenceCollected, false)
  assert.equal(review.retailerReusePermissionVerified, false)
  assert.equal(review.publicSavingsClaimEligible, false)
  assert.equal(review.liveRetailerRequests, 0)
  assert.equal(JSON.stringify(buildObservationSheet()), blankSheetBefore)
  assert.equal(JSON.stringify(m2InitialPlan), initialFixture)
})

test('M3 integrated flexible recipe: an edited Planner cannot silently approve frozen field evidence', () => {
  const input = ['--plan', 'Ma:pasta,Di:teriyaki,Wo:pasta,Do:tikka']
  const sheetBefore = JSON.stringify(buildObservationSheet())
  const selected = selectedFixtureWeek(input)
  const report = m3StudyWeekAlignment(input)
  assert.equal(selected.days.length, 4)
  assert.equal(m3FieldSheetMatchesPlannerWeek(selected.plan, selected.days), false)
  assert.equal(report.matchesFixedWorksheetDemand, false)
  assert.deepEqual(report.missingDays, [])
  assert.deepEqual(report.changedRecipes, [
    { day: 'Ma', studyRecipeId: 'tikka', selectedRecipeId: 'pasta' },
  ])
  assert.match(report.operatorInstruction, /Stop:/)
  assert.equal(report.evidenceStatus, 'preflight-only-not-an-observation')
  assert.equal(report.fieldObservationEvidenceCollected, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(JSON.stringify(buildObservationSheet()), sheetBefore)
})

test('M3 integrated partial week: missing days remain missing, not a saving', () => {
  const selected = selectedFixtureWeek(['--days', 'Ma,Do'])
  const review = m3StudyWeekAlignment(['--days', 'Ma,Do'])
  assert.equal(m3FieldSheetMatchesPlannerWeek(selected.plan, selected.days), false)
  assert.equal(review.matchesFixedWorksheetDemand, false)
  assert.deepEqual(review.missingDays, ['Di', 'Wo'])
  assert.equal(review.changedRecipes.length, 0)
  assert.equal(review.publicSavingsClaimEligible, false)
  assert.equal(review.retailerReusePermissionVerified, false)
})

test('M3 integrated field preflight never executes inherited or own accessor CLI values', () => {
  let getterCalls = 0
  const parent = Object.create(Array.prototype)
  Object.defineProperty(parent, '0', { get() { getterCalls++; return '--plan' } })
  Object.defineProperty(parent, '1', { get() { getterCalls++; return 'Ma:tikka' } })
  const inherited = new Array(2)
  Object.setPrototypeOf(inherited, parent)
  assert.throws(() => m3StudyWeekAlignment(inherited),
    /Only approved private planned-week review arguments|Only own data arguments/)
  assert.equal(getterCalls, 0)
  const ownAccessor = ['--days', 'Ma']
  Object.defineProperty(ownAccessor, '1', {
    get() { getterCalls++; return 'Ma' },
  })
  assert.throws(() => m3StudyWeekAlignment(ownAccessor),
    /Only own data arguments/)
  assert.equal(getterCalls, 0)
  const revoked = Proxy.revocable(['--days', 'Ma'], {})
  revoked.revoke()
  assert.throws(() => m3StudyWeekAlignment(revoked.proxy),
    /Only approved private planned-week review arguments/)
})
