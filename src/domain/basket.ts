import {
  matchIngredient,
  type IngredientRequirement,
  type MatchUnit,
  type ProductCandidate,
} from './matching.ts'
import { calculateDecimalPackCount, sumDecimalAmounts, sumDecimalDemandUnits } from './decimalPackArithmetic.ts'
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
  // Physical pieces need explicit human review when fractional. Other
  // dimensions can be decimal and must continue to use exact pack math.
  if (unit === 'piece') return Number.isSafeInteger(amount)
    ? { amount, family: 'piece' } : null
  return null
}

function compatibleDemandUnits(left: MatchUnit, right: MatchUnit): boolean {
  if (left === right) return true
  return (
    ((left === 'g' || left === 'kg') && (right === 'g' || right === 'kg')) ||
    ((left === 'ml' || left === 'l') && (right === 'ml' || right === 'l'))
  )
}

/** Stable output units keep equivalent demand independent of recipe order. */
function canonicalDemandUnit(unit: MatchUnit): MatchUnit {
  if (unit === 'kg') return 'g'
  if (unit === 'l') return 'ml'
  return unit
}

function canonicalIngredient(ingredient: AggregatedIngredient): AggregatedIngredient {
  const unit = canonicalDemandUnit(ingredient.unit)
  if (ingredient.amount === null || unit === ingredient.unit) {
    return { ...ingredient, unit }
  }
  return {
    ...ingredient,
    amount: sumDecimalDemandUnits(
      [{ amount: ingredient.amount, unit: ingredient.unit }],
      unit,
    ),
    unit,
  }
}

export function aggregatePlanIngredients(
  plan: PlannedMeal[],
  recipes: RecipeWithIngredients[],
  activeDays: string[],
): AggregatedIngredient[] {
  if (!Array.isArray(plan)) {
    throw new Error('Basket plan must be an array')
  }
  if (!Array.isArray(recipes)) {
    throw new Error('Basket recipes must be an array')
  }
  if (!Array.isArray(activeDays)) {
    throw new Error('Basket active days must be an array')
  }

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
      if (typeof ingredient.query !== 'string' || !ingredient.query.trim()) {
        throw new Error('Ingredient query must be non-blank')
      }

      // A recipe may legitimately read 'half an onion', but this does not
      // authorise a priced 0.5-piece retailer SKU or automatic rounding.
      // Keep the ingredient identity and show unknown shopping quantity until
      // the user reviews a whole purchasable piece in the recipe editor.
      const physicalAmount = ingredient.unit === 'piece' &&
        ingredient.amount !== null &&
        (!Number.isSafeInteger(ingredient.amount) || ingredient.amount <= 0)
          ? null : ingredient.amount
      const current = aggregated.get(ingredient.id)
      if (!current) {
        aggregated.set(ingredient.id, canonicalIngredient({ ...ingredient, amount: physicalAmount }))
        continue
      }

      if (
        current.query !== ingredient.query ||
        !compatibleDemandUnits(current.unit, ingredient.unit) ||
        current.label !== ingredient.label
      ) {
        throw new Error(`Ingredient definition drift: ${ingredient.id}`)
      }

      current.amount =
        current.amount === null || physicalAmount === null
          ? null
          : current.unit === ingredient.unit
            ? sumDecimalAmounts([current.amount, physicalAmount])
            : sumDecimalDemandUnits(
                [
                  { amount: current.amount, unit: current.unit },
                  { amount: physicalAmount, unit: ingredient.unit },
                ],
                current.unit,
              )
    }
  }

  for (const day of active) {
    if (!plannedActiveDays.has(day)) {
      throw new Error(`Missing planned meal for active day: ${day}`)
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
  selectedProducts,
}: {
  store: Store
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
  products: StoreProduct[]
  /** Explicitly chosen SKU from THIS store's admitted source, never a new price. */
  selectedProducts?: Readonly<Record<string, string>>
}): OneStoreBasket {
  if (typeof store.id !== 'string' || !store.id.trim()) {
    throw new Error('Store identity must be non-blank')
  }
  if (typeof store.name !== 'string' || !store.name.trim()) {
    throw new Error('Store name must be non-blank')
  }

  const ingredients = aggregatePlanIngredients(plan, recipes, activeDays)
  if (!Array.isArray(products)) {
    throw new Error('Basket products must be an array')
  }

  const storeProducts = products.filter(
    (product) =>
      typeof product === 'object' &&
      product !== null &&
      product.storeId === store.id &&
      typeof product.id === 'string' &&
      typeof product.name === 'string' &&
      Boolean(product.name.trim()),
  )

  const lines: BasketTraceLine[] = ingredients.map((ingredient) => {
    if (
      ingredient.amount === null ||
      !Number.isFinite(ingredient.amount) ||
      ingredient.amount <= 0 ||
      (ingredient.unit === 'piece' && !Number.isSafeInteger(ingredient.amount))
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

    const chosenId = selectedProducts?.[ingredient.id]
    // A user can resolve fuzzy-name ambiguity with an EXACT SKU already
    // present in their own selected store capture. Selection is not proof of
    // product equivalence: downstream capture-specific review is still needed.
    const selected = typeof chosenId === 'string' && chosenId.length > 0
      ? storeProducts.filter(product => product.id === chosenId) : null
    const decision = selected === null
      ? matchIngredient(ingredient, storeProducts)
      : selected.length === 1 && selected[0].available
        ? { type: 'match' as const, productId: chosenId, score: 65,
            runnerUpScore: null, reasons: ['own-source SKU explicitly selected by user, not independently verified'] }
        : { type: 'abstain' as const, score: null, runnerUpScore: null,
            reasons: ['selected product is absent, duplicated or unavailable in this store capture'] }
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

    // Decimal aggregation and whole-pack rounding share one exact arithmetic
    // contract. Never floor/epsilon-adjust a genuine above-boundary demand.
    const packs = calculateDecimalPackCount(
      [{ amount: ingredient.amount, unit: ingredient.unit }],
      { amount: product.packAmount!, unit: product.packUnit, count: packCount },
    )
    if (packs === null) {
      return {
        id: ingredient.id,
        ingredientLabel: ingredient.label,
        requirement: { amount: ingredient.amount, unit: ingredient.unit },
        status: 'unresolved',
        reasons: [...decision.reasons, 'basket quantity or pack count is not trusted'],
        matchScore: decision.score,
      }
    }
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

  // One physical supermarket SKU cannot be charged as one independent
  // purchase for multiple different ingredient identities. Those demands
  // must first be combined or assigned distinct actual source products.
  // Until then, do not show an inflated complete basket or a false winner.
  const skuCounts = new Map<string, number>()
  for (const line of lines) {
    if (line.status === 'matched')
      skuCounts.set(line.productId, (skuCounts.get(line.productId) ?? 0) + 1)
  }
  const uniquePhysicalLines: BasketTraceLine[] = lines.map(line =>
    line.status === 'matched' && (skuCounts.get(line.productId) ?? 0) > 1
      ? {
          id: line.id, ingredientLabel: line.ingredientLabel,
          requirement: line.requirement, status: 'unresolved',
          reasons: [...line.reasons, 'same source SKU would be purchased twice for different ingredient identities; combine physical demand first'],
          matchScore: line.matchScore,
        } : line)
  let totalCents = 0
  const guardedLines: BasketTraceLine[] = uniquePhysicalLines.map((line) => {
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
