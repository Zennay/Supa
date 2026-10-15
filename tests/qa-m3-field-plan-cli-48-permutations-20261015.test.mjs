import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { m2DefaultActiveDays, m2InitialPlan } from '../src/data/m2Fixture.ts'

// Independent operational parity matrix: 4! permutations for --days and
// another 4! for fully explicit --plan. Synthetic fixed M2 paper kit only.
// Does not write private files, make external requests, or modify owner source.
const script = fileURLToPath(new URL('../scripts/m3-field-plan-alignment.mjs', import.meta.url))
const originalDays = [...m2DefaultActiveDays]
const originalRecipes = new Map(m2InitialPlan.map(item => [item.day, item.recipeId]))

function permutations(values) {
  if (values.length <= 1) return [values]
  return values.flatMap((value, position) => permutations([
    ...values.slice(0, position), ...values.slice(position + 1),
  ]).map(rest => [value, ...rest]))
}

function cli(argv) {
  const execution = spawnSync(process.execPath, [
    '--experimental-strip-types', script, ...argv,
  ], { encoding: 'utf8', timeout: 10000, maxBuffer: 128 * 1024 })
  assert.ifError(execution.error)
  assert.equal(execution.status, 0, 'every complete canonical permutation is approved')
  assert.equal(execution.stderr, '')
  assert.equal(execution.stdout.split('\n').length, 2,
    'write exactly one JSON summary line, no hidden side effects')
  return JSON.parse(execution.stdout)
}

function assertGenuineSafetyBoundary(summary, canonicalOrder) {
  assert.equal(summary.fixedStudyWeekMatches, true)
  assert.equal(summary.matchesFixedWorksheetDemand, true)
  assert.deepEqual(summary.selectedDays, canonicalOrder)
  assert.deepEqual(summary.missingDays, [])
  assert.deepEqual(summary.changedRecipes, [])
  assert.equal(summary.physicalStudyIngredientsPerStore, 11)
  assert.deepEqual(summary.storesToObserve, ['PLUS', 'DekaMarkt'])
  assert.equal(summary.evidenceStatus, 'preflight-only-not-an-observation')
  assert.equal(summary.fieldObservationEvidenceCollected, false)
  assert.equal(summary.retailerReusePermissionVerified, false)
  assert.equal(summary.publicSavingsClaimEligible, false)
  assert.equal(summary.liveRetailerRequests, 0)
  assert.match(summary.operatorInstruction, /geen bronrechten|geen bronrechten, echte winkelmetingen|Deze planning past/)
}

test('QA actual CLI: all 24 full-week --days argument permutations preserve fixed-study proof only', () => {
  const all = permutations(originalDays)
  assert.equal(all.length, 24)
  const outputs = new Set()
  for (const order of all) {
    const summary = cli(['--days', order.join(',')])
    assertGenuineSafetyBoundary(summary, originalDays)
    outputs.add(JSON.stringify(summary))
  }
  assert.equal(outputs.size, 1, 'caller order must not alter the truth summary')
})

test('QA actual CLI: all 24 exact --plan recipe/day argument permutations preserve the same week truth', () => {
  const all = permutations(originalDays)
  assert.equal(all.length, 24)
  const outputs = new Set()
  for (const order of all) {
    const args = ['--plan', order.map(day => day + ':' + originalRecipes.get(day)).join(',')]
    const summary = cli(args)
    assertGenuineSafetyBoundary(summary, originalDays)
    outputs.add(JSON.stringify(summary))
  }
  assert.equal(outputs.size, 1, 'permuted canonical recipes must not alter operator instructions')
  assert.deepEqual(m2DefaultActiveDays, originalDays)
  assert.deepEqual(new Map(m2InitialPlan.map(x => [x.day, x.recipeId])), originalRecipes)
})

test('QA actual CLI: canonical default, all-days and full --plan have byte-identical output', () => {
  const implicit = cli([])
  const allDays = cli(['--days', originalDays.join(',')])
  const allMeals = cli(['--plan', originalDays.map(d => d + ':' + originalRecipes.get(d)).join(',')])
  assert.deepEqual(allDays, implicit)
  assert.deepEqual(allMeals, implicit)
  assertGenuineSafetyBoundary(implicit, originalDays)
})
