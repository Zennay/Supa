import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { m2DefaultActiveDays, m2Recipes, m2InitialPlan } from '../src/data/m2Fixture.ts'
import { main as memoryMain } from '../scripts/retailer-reviewed-custom-week.mjs'

// Separate quality-validation test against the *real* two CLI entrypoints.
// Uses only the six repository-owned archival offline snapshots and frozen M2
// recipes, never any current retailer endpoint, customer, price or permission.
const recipeIds = m2Recipes.map(x => x.id)
const days = [...m2DefaultActiveDays]
const recipeById = new Map(m2Recipes.map(x => [x.id, x]))
const memoryCli = fileURLToPath(new URL('../scripts/retailer-reviewed-custom-week.mjs', import.meta.url))
const sqliteCli = fileURLToPath(new URL('../scripts/retailer-private-sqlite-planner-review.mjs', import.meta.url))
const originalPlan = structuredClone(m2InitialPlan)

function* plans() {
  for (let mask = 1; mask < 2 ** days.length; mask++) {
    const selected = days.filter((_, i) => (mask & (1 << i)) !== 0)
    const size = recipeIds.length ** selected.length
    for (let n = 0; n < size; n++) {
      let code = n
      const selection = selected.map(day => {
        const choice = [day, recipeIds[code % recipeIds.length]]
        code = Math.floor(code / recipeIds.length)
        return choice
      })
      yield selection
    }
  }
}

function oracle(selection) {
  const ingredients = new Set()
  for (const [, id] of selection) {
    const recipe = recipeById.get(id)
    assert.ok(recipe, 'approved recipe fixture is known')
    for (const item of recipe.ingredients) ingredients.add(item.id)
  }
  return { days: selection.length, needs: ingredients.size, rows: 2 * ingredients.size }
}

function assertPrivate(summary, json) {
  assert.equal(summary.publicSavingsClaimEligible, false)
  assert.equal(summary.livePricesAvailable, false)
  assert.equal(summary.externalRequests, 0)
  assert.doesNotMatch(json, /https?:|sourceUrl|sourceProductId|productName|ingredientId|capturedAt|priceCents|offerPriceCents|savingsCents|participantKey|€|sha256/i)
}

function processCli(filename, specification) {
  const result = spawnSync(process.execPath, [
    '--experimental-strip-types', filename, '--plan', specification,
  ], { encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 })
  assert.equal(result.error, undefined, 'CLI must return without timeout')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  assert.match(result.stdout, /^\{[^\n]*\}\n$/, 'only one aggregate-only JSON line')
  const payload = JSON.parse(result.stdout)
  assertPrivate(payload, result.stdout)
  return payload
}

test('actual memory CLI handler: all 255 M2 choices produce count-correct private JSON without source or price leakage', async () => {
  let checked = 0
  for (const choices of plans()) {
    checked++
    const spec = choices.map(([day, id]) => day + ':' + id).join(',')
    const expected = oracle(choices)
    let output = ''
    const summary = await memoryMain(['--plan', spec], t => { output += t })
    assert.equal(output, JSON.stringify(summary) + '\n', 'output is one canonical JSON record')
    assert.equal(summary.mode, 'dynamic-week-private-review-only')
    assert.equal(summary.activeDays, expected.days, spec)
    assert.equal(summary.selectedMeals, expected.days, spec)
    assert.equal(summary.uniqueIngredientNeeds, expected.needs, spec)
    assert.equal(summary.retailerReviewRows, expected.rows, spec)
    assert.ok(summary.proposedForManualReview >= 0 && summary.proposedForManualReview <= expected.rows)
    assert.ok(summary.unresolved >= 0 && summary.unresolved <= expected.rows)
    assertPrivate(summary, output)
  }
  assert.equal(checked, 255)
  assert.deepEqual(m2InitialPlan, originalPlan, 'all CLI selections are read-only')
})

test('real Node subprocess memory CLI and private SQLite/Python CLI agree for all twelve single-day/recipe choices', () => {
  let checked = 0
  for (const day of days) {
    for (const id of recipeIds) {
      const spec = day + ':' + id
      const memory = processCli(memoryCli, spec)
      const sqlite = processCli(sqliteCli, spec)
      const expected = oracle([[day, id]])
      assert.equal(sqlite.mode, 'persisted-private-sqlite-to-dynamic-planner-review')
      assert.equal(sqlite.sourceSnapshots, 6)
      assert.equal(sqlite.selectedMealDays, expected.days, spec)
      assert.equal(sqlite.ingredientNeeds, expected.needs, spec)
      assert.equal(sqlite.retailerReviewRows, expected.rows, spec)
      assert.equal(memory.uniqueIngredientNeeds, sqlite.ingredientNeeds, spec)
      assert.equal(memory.retailerReviewRows, sqlite.retailerReviewRows, spec)
      assert.equal(memory.unresolved, sqlite.unresolved, spec)
      assert.equal(memory.proposedForManualReview, sqlite.proposedForManualReview, spec)
      assert.equal(sqlite.productionEnabled, false)
      checked++
    }
  }
  assert.equal(checked, 12)
  assert.deepEqual(m2InitialPlan, originalPlan)
})

test('independent stored SQLite and memory process parity for every possible two-day pair, including different recipe swaps', () => {
  let checked = 0
  for (let i = 0; i < days.length; i++) {
    for (let j = i + 1; j < days.length; j++) {
      const choices = [[days[i], recipeIds[(i + j) % 3]],
        [days[j], recipeIds[(i + 2 * j) % 3]]]
      const spec = choices.map(([day, id]) => day + ':' + id).join(',')
      const expected = oracle(choices)
      const memory = processCli(memoryCli, spec)
      const sqlite = processCli(sqliteCli, spec)
      assert.equal(memory.activeDays, expected.days)
      assert.equal(memory.uniqueIngredientNeeds, expected.needs)
      assert.equal(sqlite.ingredientNeeds, expected.needs)
      assert.equal(memory.retailerReviewRows, expected.rows)
      assert.equal(sqlite.retailerReviewRows, expected.rows)
      assert.equal(memory.unresolved, sqlite.unresolved)
      assert.equal(memory.proposedForManualReview, sqlite.proposedForManualReview)
      assert.equal(sqlite.sourceSnapshots, 6)
      assert.equal(sqlite.productionEnabled, false)
      checked++
    }
  }
  assert.equal(checked, 6)
})
