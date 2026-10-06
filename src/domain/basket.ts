import {
  matchIngredient,
  type IngredientRequirement,
  type MatchUnit,
  type ProductCandidate,
} from './matching.ts'
import type { PlannedMeal, Recipe, Store } from './types.ts'

export type RecipeIngredient = IngredientRequirement & {
  label: string
}

export type RecipeWithIngredients = Recipe & {
  ingredients: RecipeIngredient[]
}

export type StoreProduct = ProductCandidate & {
  storeId: string
  priceCents: number
}

export type BasketTraceLine =
  | {
      id: string
      ingredientLabel: string
      requirement: { amount: number; unit: MatchUnit }
      status: 'matched'
      productId: string
      productName: string
      packs: number
      pack: { amount: number; unit: MatchUnit; count: number }
      pricePerPackCents: number
      lineTotalCents: number
      matchScore: number
      reasons: string[]
    }
  | {
      id: string
      ingredientLabel: string
      requirement: { amount: number | null; unit: MatchUnit }
      status: 'unresolved'
      reasons: string[]
      matchScore: number | null
    }

export type OneStoreBasket = {
  store: Store
  selectedMealCount: number
  lines: BasketTraceLine[]
  totalCents: number
  matchedLineCount: number
  unresolvedLineCount: number
}

type AggregatedIngredient = RecipeIngredient & {
  amount: number | null
}

function baseAmount(
  amount: number,
  unit: MatchUnit,
): { amount: number; family: 'mass' | 'volume' | 'piece' } | null {
  if (!Number.isFinite(amount) || amount <= 0) return null
  if (unit === 'kg') return { amount: amount * 1000, family: 'mass' }
  if (unit === 'g') return { amount, family: 'mass' }
  if (unit === 'l') return { amount: amount * 1000, family: 'volume' }
  if (unit === 'ml') return { amount, family: 'volume' }
  if (unit === 'piece') return { amount, family: 'piece' }
  return null
}

export function aggregatePlanIngredients(
  plan: PlannedMeal[],
  recipes: RecipeWithIngredients[],
  activeDays: string[],
): AggregatedIngredient[] {
  const active = new Set(activeDays)
  const aggregated = new Map<string, AggregatedIngredient>()
  const plannedActiveDays = new Set<string>()

  for (const meal of plan) {
    if (!active.has(meal.day)) continue
    if (plannedActiveDays.has(meal.day)) {
      throw new Error(`Ambiguous planned day: ${meal.day}`)
    }
    plannedActiveDays.add(meal.day)

    const matchingRecipes = recipes.filter(
      (candidate) => candidate.id === meal.recipeId,
    )
    if (matchingRecipes.length === 0) {
      throw new Error(`Missing recipe for planned meal: ${meal.recipeId}`)
    }
    if (matchingRecipes.length > 1) {
      throw new Error(`Ambiguous recipe for planned meal: ${meal.recipeId}`)
    }

    const recipe = matchingRecipes[0]

    for (const ingredient of recipe.ingredients) {
      if (typeof ingredient.id !== 'string' || !ingredient.id.trim()) {
        throw new Error('Ingredient identity must be non-blank')
      }
      if (typeof ingredient.label !== 'string' || !ingredient.label.trim()) {
        throw new Error('Ingredient label must be non-blank')
      }

      const current = aggregated.get(ingredient.id)
      if (!current) {
        aggregated.set(ingredient.id, { ...ingredient })
        continue
      }

      if (
        current.query !== ingredient.query ||
        current.unit !== ingredient.unit ||
        current.label !== ingredient.label
      ) {
        throw new Error(`Ingredient definition drift: ${ingredient.id}`)
      }

      current.amount =
        current.amount === null || ingredient.amount === null
          ? null
          : current.amount + ingredient.amount
    }
  }

  return [...aggregated.values()].sort((a, b) => a.id.localeCompare(b.id))
}

export function buildOneStoreBasket({
  store,
  plan,
  recipes,
  activeDays,
  products,
}: {
  store: Store
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
  products: StoreProduct[]
}): OneStoreBasket {
  if (typeof store.id !== 'string' || !store.id.trim()) {
    throw new Error('Store identity must be non-blank')
  }
  if (typeof store.name !== 'string' || !store.name.trim()) {
    throw new Error('Store name must be non-blank')
  }

  const ingredients = aggregatePlanIngredients(plan, recipes, activeDays)
  const storeProducts = products.filter((product) => product.storeId === store.id)

  const lines: BasketTraceLine[] = ingredients.map((ingredient) => {
    if (
      ingredient.amount === null ||
      !Number.isFinite(ingredient.amount) ||
      ingredient.amount <= 0
    ) {
      return {
        id: ingredient.id,
        ingredientLabel: ingredient.label,
        requirement: { amount: ingredient.amount, unit: ingredient.unit },
        status: 'unresolved',
        reasons: ['ingredient amount unknown or invalid'],
        matchScore: null,
      }
    }

    const decision = matchIngredient(ingredient, storeProducts)
    if (decision.type === 'abstain') {
      return {
        id: ingredient.id,
        ingredientLabel: ingredient.label,
        requirement: { amount: ingredient.amount, unit: ingredient.unit },
        status: 'unresolved',
        reasons: decision.reasons,
        matchScore: decision.score,
      }
    }

    const matchedProducts = storeProducts.filter(
      (candidate) => candidate.id === decision.productId,
    )
    if (matchedProducts.length !== 1) {
      return {
        id: ingredient.id,
        ingredientLabel: ingredient.label,
        requirement: { amount: ingredient.amount, unit: ingredient.unit },
        status: 'unresolved',
        reasons: [
          matchedProducts.length === 0
            ? 'matched product missing from store catalog'
            : 'matched product identity is not unique in store catalog',
        ],
        matchScore: decision.score,
      }
    }

    const product = matchedProducts[0]

    if (typeof product.id !== 'string' || !product.id.trim()) {
      return {
        id: ingredient.id,
        ingredientLabel: ingredient.label,
        requirement: { amount: ingredient.amount, unit: ingredient.unit },
        status: 'unresolved',
        reasons: [
          ...decision.reasons,
          'matched product identity is blank or malformed',
        ],
        matchScore: decision.score,
      }
    }

    if (typeof product.name !== 'string' || !product.name.trim()) {
      return {
        id: ingredient.id,
        ingredientLabel: ingredient.label,
        requirement: { amount: ingredient.amount, unit: ingredient.unit },
        status: 'unresolved',
        reasons: [
          ...decision.reasons,
          'matched product name is blank or malformed',
        ],
        matchScore: decision.score,
      }
    }

    const packCount = product.packCount ?? 1
    const required = baseAmount(ingredient.amount, ingredient.unit)
    const pack =
      product.packAmount === null
        ? null
        : baseAmount(product.packAmount * packCount, product.packUnit)

    if (
      !required ||
      !pack ||
      required.family !== pack.family ||
      !Number.isSafeInteger(product.priceCents) ||
      product.priceCents < 0
    ) {
      return {
        id: ingredient.id,
        ingredientLabel: ingredient.label,
        requirement: { amount: ingredient.amount, unit: ingredient.unit },
        status: 'unresolved',
        reasons: [...decision.reasons, 'basket quantity or price is not trusted'],
        matchScore: decision.score,
      }
    }

    const packs = Math.ceil(required.amount / pack.amount)
    const lineTotalCents = packs * product.priceCents
    if (!Number.isSafeInteger(packs) || !Number.isSafeInteger(lineTotalCents)) {
      return {
        id: ingredient.id,
        ingredientLabel: ingredient.label,
        requirement: { amount: ingredient.amount, unit: ingredient.unit },
        status: 'unresolved',
        reasons: [
          ...decision.reasons,
          'basket quantity or monetary total exceeds the safe integer range',
        ],
        matchScore: decision.score,
      }
    }

    return {
      id: ingredient.id,
      ingredientLabel: ingredient.label,
      requirement: { amount: ingredient.amount, unit: ingredient.unit },
      status: 'matched',
      productId: product.id,
      productName: product.name,
      packs,
      pack: {
        amount: product.packAmount!,
        unit: product.packUnit,
        count: packCount,
      },
      pricePerPackCents: product.priceCents,
      lineTotalCents,
      matchScore: decision.score,
      reasons: decision.reasons,
    }
  })

  let totalCents = 0
  const guardedLines: BasketTraceLine[] = lines.map((line) => {
    if (line.status === 'unresolved') return line

    const nextTotalCents = totalCents + line.lineTotalCents
    if (!Number.isSafeInteger(nextTotalCents)) {
      return {
        id: line.id,
        ingredientLabel: line.ingredientLabel,
        requirement: line.requirement,
        status: 'unresolved',
        reasons: [
          ...line.reasons,
          'basket monetary total exceeds the safe integer range',
        ],
        matchScore: line.matchScore,
      }
    }

    totalCents = nextTotalCents
    return line
  })

  const matched = guardedLines.filter(
    (line): line is Extract<BasketTraceLine, { status: 'matched' }> =>
      line.status === 'matched',
  )

  return {
    store,
    selectedMealCount: plan.filter((meal) => activeDays.includes(meal.day)).length,
    lines: guardedLines,
    totalCents,
    matchedLineCount: matched.length,
    unresolvedLineCount: guardedLines.length - matched.length,
  }
}
