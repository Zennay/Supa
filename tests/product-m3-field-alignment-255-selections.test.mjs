import assert from 'node:assert/strict'
import test from 'node:test'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import { m3StudyWeekAlignment } from '../scripts/m3-field-plan-alignment.mjs'

/**
 * All nonempty subsets of four approved days, each with one of the three
 * approved fixture recipes: (1 + 3)^4 - 1 = 255 choices.
 * Exactly one choice is allowed to identify the frozen 11×2 research week.
 */
test('255 real controlled recipe/day week selections: only the exact four-meal research fixture can preflight GREEN', () => {
  const initial = structuredClone(m2InitialPlan)
  const recipes = m2Recipes.map(recipe => recipe.id)
  const options = [null, ...recipes]
  let scenarios = 0
  let aligned = 0
  let misaligned = 0

  for (const a of options) {
    for (const b of options) {
      for (const c of options) {
        for (const d of options) {
          const assignments = [a, b, c, d]
          if (assignments.every(value => value === null)) continue
          const argumentsByDay = m2DefaultActiveDays
            .flatMap((day, i) => assignments[i] === null ? [] : [day + ':' + assignments[i]])
          const summary = m3StudyWeekAlignment(['--plan', argumentsByDay.join(',')])
          const expectedCanonical = initial.every((row, index) => assignments[index] === row.recipeId)
          const expectedMissingDays = initial
            .filter((_, index) => assignments[index] === null)
            .map(row => row.day)
          const expectedChangedDays = initial
            .filter((row, index) => assignments[index] !== null && assignments[index] !== row.recipeId)
            .map(row => row.day)

          assert.equal(summary.fixedStudyWeekMatches, expectedCanonical, argumentsByDay.join(','))
          assert.equal(summary.matchesFixedWorksheetDemand, expectedCanonical)
          assert.deepEqual(summary.missingDays, expectedMissingDays)
          assert.deepEqual(summary.changedRecipes.map(item => item.day), expectedChangedDays)
          assert.equal(summary.physicalStudyIngredientsPerStore, 11)
          assert.deepEqual(summary.storesToObserve, ['PLUS', 'DekaMarkt'])
          assert.equal(summary.evidenceStatus, 'preflight-only-not-an-observation')
          assert.equal(summary.retailerReusePermissionVerified, false)
          assert.equal(summary.fieldObservationEvidenceCollected, false)
          assert.equal(summary.publicSavingsClaimEligible, false)
          assert.equal(summary.liveRetailerRequests, 0)
          scenarios++
          if (summary.fixedStudyWeekMatches) aligned++
          else misaligned++
        }
      }
    }
  }

  assert.equal(scenarios, 255)
  assert.equal(aligned, 1)
  assert.equal(misaligned, 254)
  assert.deepEqual(m2InitialPlan, initial)
})
