import {
  buildOneStoreBasket,
  type OneStoreBasket,
  type RecipeWithIngredients,
  type StoreProduct,
} from './basket.ts'
import { calculateDecimalPackCount, sumDecimalAmounts } from './decimalPackArithmetic.ts'
import { matchIngredient, type MatchUnit } from './matching.ts'
import type { PlannedMeal, Store } from './types.ts'

export type ExactDecimalBasketInput = {
  store: Store
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
  products: StoreProduct[]
}

type SourceDemand = {
  label: string
  query: string
  unit: MatchUnit
  amounts: number[]
  hasUnknown: boolean
}

/**
 * Pre-integration basket variant for decimal ingredient reuse (#1053).
 *
 * The canonical basket builder remains the match/source authority. We
 * recompute whole-pack purchases using ORIGINAL per-meal decimal quantities
 * before repairing only the derived pack/cents trace. This avoids the
 * 0.1 + 0.2 -> 0.30000000000000004 intermediary.
 *
 * Returns null if canonical product matching changes under exact demand:
 * never patch a questionable product choice to manufacture a price claim.
 * The existing basket owner #273 retains production/ShoppingListView wiring.
 */
export function buildExactDecimalOneStoreBasket(
  input: ExactDecimalBasketInput,
): OneStoreBasket | null {
  if (!input || typeof input !== 'object' ||
      !Array.isArray(input.plan) || !Array.isArray(input.recipes) ||
      !Array.isArray(input.activeDays) || !Array.isArray(input.products) ||
      new Set(input.activeDays).size !== input.activeDays.length) return null

  try {
    const initial = buildOneStoreBasket(input)
    const active = new Set(input.activeDays)
    const groups = new Map<string, SourceDemand>()

    for (const meal of input.plan) {
      if (!active.has(meal.day)) continue
      const recipes = input.recipes.filter((r) => r.id === meal.recipeId)
      if (recipes.length !== 1) return null

      for (const ingredient of recipes[0].ingredients) {
        const current = groups.get(ingredient.id)
        if (current && (
          current.label !== ingredient.label ||
          current.query !== ingredient.query ||
          current.unit !== ingredient.unit
        )) return null

        const group = current ?? {
          label: ingredient.label, query: ingredient.query,
          unit: ingredient.unit, amounts: [], hasUnknown: false,
        }
        if (ingredient.amount === null) {
          group.hasUnknown = true
        } else {
          group.amounts.push(ingredient.amount)
        }
        groups.set(ingredient.id, group)
      }
    }

    if (groups.size !== initial.lines.length) return null

    const products = input.products.filter((product) =>
      product !== null && typeof product === 'object' &&
      product.storeId === input.store.id &&
      typeof product.id === 'string' &&
      typeof product.name === 'string' && Boolean(product.name.trim()),
    )

    let totalCents = 0
    const lines: OneStoreBasket['lines'] = []
    for (const line of initial.lines) {
      const source = groups.get(line.id)
      if (!source || source.unit !== line.requirement.unit ||
          source.label !== line.ingredientLabel) return null

      const amount = source.hasUnknown ? null : sumDecimalAmounts(source.amounts)
      if (line.status !== 'matched') {
        // Never convert an unresolved line into a matched purchase.
        lines.push({
          ...line,
          requirement: { ...line.requirement, amount },
        })
        continue
      }

      if (amount === null) return null
      const decision = matchIngredient(
        { id: line.id, query: source.query, amount, unit: source.unit },
        products,
      )
      if (decision.type !== 'match' || decision.productId !== line.productId) {
        return null
      }

      const packs = calculateDecimalPackCount(
        source.amounts.map((part) => ({ amount: part, unit: source.unit })),
        line.pack,
      )
      if (packs === null || !Number.isSafeInteger(line.pricePerPackCents) ||
          line.pricePerPackCents < 0) return null

      const lineTotalCents = packs * line.pricePerPackCents
      const nextTotal = totalCents + lineTotalCents
      if (!Number.isSafeInteger(lineTotalCents) || !Number.isSafeInteger(nextTotal)) return null
      totalCents = nextTotal

      lines.push({
        ...line,
        requirement: { ...line.requirement, amount },
        packs,
        lineTotalCents,
        matchScore: decision.score,
        reasons: decision.reasons,
      })
    }

    return { ...initial, lines, totalCents }
  } catch {
    // Malformed planner, catalog, or source demand must never quote money.
    return null
  }
}
