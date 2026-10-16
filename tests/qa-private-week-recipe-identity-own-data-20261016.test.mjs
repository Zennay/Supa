/**
 * Independent QA on frozen seven-day private week planner owner #3300,
 * d7a3bad25ad91772110c995903d857ab1d867926.
 * Unsafe caller recipe identity must fail closed without executing inherited
 * accessor code before reviewed private shopping calculation.
 * Fictional in-memory records only, zero network/store/personal data.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareUnpricedPrivateRecipe } from '../src/features/user-recipes/reviewedRecipeBasketBridge.ts'
import { createPrivateRecipeWeekPreview } from '../src/features/user-recipes/privateWeekPlanner.ts'

function reviewed() {
  const outcome = prepareUnpricedPrivateRecipe({
    source: 'manual', sourceUrl: null, title: 'Fictief ontbijt',
    servings: 2, minutes: 10, warnings: [], status: 'needs_review',
    steps: ['Roer'], ingredients: [{
      clientId: 'ingredient-1', original: '200 g rijst', label: 'Rijst',
      query: 'rijst', amount: 200, unit: 'g', reviewReason: null,
    }],
  }, 'legitimate')
  assert.equal(outcome.status, 'unpriced_ready')
  return outcome.recipe
}

test('positive: own data identity stays eligible for private no-price week', () => {
  const source = reviewed()
  const output = createPrivateRecipeWeekPreview([source], { Ma: source.id })
  assert.equal(output.status, 'preview_ready')
  assert.equal(output.preview.savingsVerified, false)
})

test('inherited recipe ID getter must not run during week admission [EXPECTED RED]', () => {
  const safe = reviewed()
  let getterCalls = 0
  const hostile = Object.create({
    get id() {
      getterCalls++
      return safe.id
    },
  })
  // Copy the remaining own data facts without assigning to inherited get-only id.
  // The original fixture never reached product code because Object.assign threw.
  for (const [key, value] of Object.entries(safe)) {
    if (key !== 'id') hostile[key] = value
  }
  const result = createPrivateRecipeWeekPreview([hostile], { Ma: safe.id })
  assert.equal(getterCalls, 0,
    'caller-provided prototype getters must not execute before recipe identity validation')
  assert.deepEqual(result, { status: 'review_required', reason: 'invalid_selection' })
})

test('own non-data recipe identity getter must not run during week admission [EXPECTED RED]', () => {
  const safe = reviewed()
  let getterCalls = 0
  const candidate = { ...safe }
  Object.defineProperty(candidate, 'id', {
    enumerable: true, configurable: true,
    get() {
      getterCalls++
      return safe.id
    },
  })
  const result = createPrivateRecipeWeekPreview([candidate], { Ma: safe.id })
  assert.equal(getterCalls, 0,
    'getters are not passive recipe identity data')
  assert.deepEqual(result, { status: 'review_required', reason: 'invalid_selection' })
})
