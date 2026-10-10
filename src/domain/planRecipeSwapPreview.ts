import { buildOneStoreBasket, type BasketTraceLine, type OneStoreBasket, type RecipeWithIngredients, type StoreProduct } from './basket.ts'
import type { PlannedMeal, Store } from './types.ts'

/**
 * A same-store, same-catalog *planning* preview. Prices can be controlled
 * fixtures: deltaCents is never evidence of live prices or customer savings.
 */
type EvaluatedSwap = {
  nextPlan: PlannedMeal[]
  before: OneStoreBasket
  after: OneStoreBasket
  changes: Array<{
    ingredientId: string
    kind: 'added' | 'removed' | 'changed'
    before: BasketTraceLine | null
    after: BasketTraceLine | null
  }>
  priceEvidence: 'input-snapshot-only'
}

export type PlanRecipeSwapPreview =
  | { status: 'invalid'; reason: string; deltaCents: null; changes: [] }
  | (EvaluatedSwap & { status: 'ready'; reason: null; deltaCents: number })
  | (EvaluatedSwap & { status: 'unknown'; reason: string; deltaCents: null })

export type PlanRecipeSwapInput = {
  store: Store
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
  products: StoreProduct[]
  day: string
  replacementRecipeId: string
}

function canonical(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
}

function invalid(reason: string): PlanRecipeSwapPreview {
  return { status: 'invalid', reason, deltaCents: null, changes: [] }
}

function signature(line: BasketTraceLine): string {
  return JSON.stringify(
    line.status === 'matched'
      ? {
          status: line.status,
          requirement: line.requirement,
          productId: line.productId,
          packs: line.packs,
          pack: line.pack,
          pricePerPackCents: line.pricePerPackCents,
          lineTotalCents: line.lineTotalCents,
        }
      : {
          status: line.status,
          requirement: line.requirement,
          reasons: line.reasons,
        },
  )
}

function safeCompleteBasket(basket: OneStoreBasket): boolean {
  if (basket.selectedMealCount === 0 || basket.unresolvedLineCount !== 0) {
    return false
  }
  if (basket.lines.length === 0 || basket.lines.length !== basket.matchedLineCount) {
    return false
  }

  let summedCents = 0
  for (const line of basket.lines) {
    if (line.status !== 'matched') return false
    if (
      !Number.isSafeInteger(line.packs) || line.packs < 1 ||
      !Number.isSafeInteger(line.pricePerPackCents) || line.pricePerPackCents < 0 ||
      !Number.isSafeInteger(line.lineTotalCents) ||
      line.lineTotalCents !== line.packs * line.pricePerPackCents
    ) return false
    summedCents += line.lineTotalCents
    if (!Number.isSafeInteger(summedCents)) return false
  }
  return summedCents === basket.totalCents
}

/**
 * Evaluate one recipe replacement without mutating saved preferences or the
 * catalog. A change to the plan is NOT a change to the shopping list until the
 * user explicitly accepts it. The caller must label source freshness.
 */
export function previewPlanRecipeSwap(input: PlanRecipeSwapInput): PlanRecipeSwapPreview {
  if (!input || typeof input !== 'object') return invalid('invalid input')
  const { store, plan, recipes, activeDays, products, day, replacementRecipeId } = input

  if (
    !canonical(day) || !canonical(replacementRecipeId) ||
    !Array.isArray(plan) || !Array.isArray(recipes) ||
    !Array.isArray(activeDays) || !Array.isArray(products)
  ) return invalid('malformed planning input')
  if (
    !store || !canonical(store.id) || !canonical(store.name) ||
    activeDays.some((candidate) => !canonical(candidate)) ||
    new Set(activeDays).size !== activeDays.length
  ) return invalid('invalid store or active days')

  const planDays = new Set<string>()
  for (const meal of plan) {
    if (
      !meal || !canonical(meal.day) || !canonical(meal.recipeId) ||
      planDays.has(meal.day)
    ) return invalid('ambiguous or malformed planned meal')
    planDays.add(meal.day)
  }
  if (!planDays.has(day)) return invalid('day is not present in the plan')
  if (activeDays.some((activeDay) => !planDays.has(activeDay))) {
    return invalid('active day has no planned meal')
  }
  if (recipes.filter((recipe) => recipe && recipe.id === replacementRecipeId).length !== 1) {
    return invalid('replacement recipe is absent or ambiguous')
  }
  const originalRecipeId = plan.find((meal) => meal.day === day)?.recipeId
  if (recipes.filter((recipe) => recipe && recipe.id === originalRecipeId).length !== 1) {
    return invalid('original recipe is absent or ambiguous')
  }

  const nextPlan = plan.map((meal) =>
    meal.day === day ? { day: meal.day, recipeId: replacementRecipeId } : { ...meal },
  )
  let before: OneStoreBasket
  let after: OneStoreBasket
  try {
    before = buildOneStoreBasket({ store, plan, recipes, activeDays, products })
    after = buildOneStoreBasket({ store, plan: nextPlan, recipes, activeDays, products })
  } catch {
    return invalid('plan or catalog cannot be evaluated')
  }

  const oldLines = new Map(before.lines.map((line) => [line.id, line]))
  const newLines = new Map(after.lines.map((line) => [line.id, line]))
  if (oldLines.size !== before.lines.length || newLines.size !== after.lines.length) {
    return invalid('duplicate ingredient identity')
  }
  const changes: Extract<PlanRecipeSwapPreview, { status: 'ready' | 'unknown' }>['changes'] = []
  for (const ingredientId of [...new Set([...oldLines.keys(), ...newLines.keys()])].sort()) {
    const previous = oldLines.get(ingredientId) ?? null
    const next = newLines.get(ingredientId) ?? null
    if (previous && next && signature(previous) === signature(next)) continue
    changes.push({
      ingredientId,
      kind: previous && next ? 'changed' : previous ? 'removed' : 'added',
      before: previous,
      after: next,
    })
  }

  const complete = safeCompleteBasket(before) && safeCompleteBasket(after)
  const delta = after.totalCents - before.totalCents
  const snapshot: EvaluatedSwap = {
    nextPlan,
    before,
    after,
    changes,
    priceEvidence: 'input-snapshot-only',
  }
  if (complete && Number.isSafeInteger(delta)) {
    return { ...snapshot, status: 'ready', reason: null, deltaCents: delta }
  }

  return {
    ...snapshot,
    status: 'unknown',
    reason:
      before.selectedMealCount === 0 || after.selectedMealCount === 0
        ? 'no active meals to price'
        : 'unresolved or unsafe basket prices',
    deltaCents: null,
  }
}
