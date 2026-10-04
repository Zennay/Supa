import type { RawProductObservation, SupermarketId } from '../data/ingestion'
import {
  matchIngredient,
  type IngredientRequirement,
  type MatchDecision,
  type MatchUnit,
  type ProductCandidate,
} from './matching'

export type M2Ingredient = IngredientRequirement & {
  label: string
}

export type M2Recipe = {
  id: string
  title: string
  ingredients: M2Ingredient[]
}

export type M2PlanItem = {
  day: string
  recipeId: string
}

export type AggregatedIngredientRequirement = IngredientRequirement & {
  label: string
  occurrences: number
  recipeIds: string[]
}

export type BasketTrace = {
  match: MatchDecision
  sourceProductId: string | null
  provenance: RawProductObservation['provenance'] | null
  warnings: string[]
}

export type MatchedBasketLine = {
  status: 'matched'
  ingredient: AggregatedIngredientRequirement
  product: RawProductObservation
  packs: number
  linePriceCents: number
  trace: BasketTrace
}

export type UnresolvedBasketLine = {
  status: 'unresolved'
  ingredient: AggregatedIngredientRequirement
  trace: BasketTrace
}

export type M2BasketLine = MatchedBasketLine | UnresolvedBasketLine

export type SingleStoreBasket = {
  supermarket: SupermarketId
  activeDays: string[]
  lines: M2BasketLine[]
  totalCents: number
  complete: boolean
}

export type ShoppingListItem = {
  id: string
  label: string
  quantity: string
  priceCents: number | null
  needsReview: boolean
  trace: string[]
}

type BaseQuantity = {
  amount: number
  family: 'mass' | 'volume' | 'piece'
}

function toBaseQuantity(amount: number, unit: MatchUnit): BaseQuantity | null {
  if (!Number.isFinite(amount) || amount <= 0) return null
  if (unit === 'kg') return { amount: amount * 1000, family: 'mass' }
  if (unit === 'g') return { amount, family: 'mass' }
  if (unit === 'l') return { amount: amount * 1000, family: 'volume' }
  if (unit === 'ml') return { amount, family: 'volume' }
  if (unit === 'piece') return { amount, family: 'piece' }
  return null
}

function observationUnit(unit: RawProductObservation['pack']['unit']): MatchUnit {
  return unit === 'pack' ? 'unknown' : unit
}

function productCandidate(
  observation: RawProductObservation,
): ProductCandidate | null {
  if (!observation.sourceProductId) return null

  return {
    id: observation.sourceProductId,
    name: observation.name,
    packAmount: observation.pack.amount,
    packUnit: observationUnit(observation.pack.unit),
    packCount: 1,
    available: observation.availability !== 'unavailable',
  }
}

function aggregateIngredients(
  plan: M2PlanItem[],
  activeDays: string[],
  recipes: M2Recipe[],
): AggregatedIngredientRequirement[] {
  const active = new Set(activeDays)
  const byRecipe = new Map(recipes.map((recipe) => [recipe.id, recipe]))
  const aggregate = new Map<string, AggregatedIngredientRequirement>()

  for (const item of plan) {
    if (!active.has(item.day)) continue
    const recipe = byRecipe.get(item.recipeId)
    if (!recipe) {
      throw new Error(`Unknown M2 recipe in plan: ${item.recipeId}`)
    }

    for (const ingredient of recipe.ingredients) {
      const current = aggregate.get(ingredient.id)
      if (!current) {
        aggregate.set(ingredient.id, {
          id: ingredient.id,
          label: ingredient.label,
          query: ingredient.query,
          amount: ingredient.amount,
          unit: ingredient.unit,
          occurrences: 1,
          recipeIds: [recipe.id],
        })
        continue
      }

      if (
        current.unit !== ingredient.unit ||
        current.query !== ingredient.query ||
        current.label !== ingredient.label
      ) {
        throw new Error(
          `Ingredient ${ingredient.id} has inconsistent M2 definitions`,
        )
      }

      current.amount =
        current.amount === null || ingredient.amount === null
          ? null
          : current.amount + ingredient.amount
      current.occurrences += 1
      if (!current.recipeIds.includes(recipe.id)) {
        current.recipeIds.push(recipe.id)
      }
    }
  }

  return [...aggregate.values()].sort((a, b) => a.id.localeCompare(b.id))
}

function unresolved(
  ingredient: AggregatedIngredientRequirement,
  match: MatchDecision,
  reasons: string[],
  observation: RawProductObservation | null = null,
): UnresolvedBasketLine {
  return {
    status: 'unresolved',
    ingredient,
    trace: {
      match,
      sourceProductId: observation?.sourceProductId ?? null,
      provenance: observation?.provenance ?? null,
      warnings: reasons,
    },
  }
}

export function buildSingleStoreBasket({
  supermarket,
  plan,
  activeDays,
  recipes,
  observations,
}: {
  supermarket: SupermarketId
  plan: M2PlanItem[]
  activeDays: string[]
  recipes: M2Recipe[]
  observations: RawProductObservation[]
}): SingleStoreBasket {
  const storeObservations = observations.filter(
    (observation) => observation.supermarket === supermarket,
  )

  const candidatePairs = storeObservations
    .map((observation) => ({
      observation,
      candidate: productCandidate(observation),
    }))
    .filter(
      (
        pair,
      ): pair is {
        observation: RawProductObservation
        candidate: ProductCandidate
      } => pair.candidate !== null,
    )

  const candidates = candidatePairs.map((pair) => pair.candidate)
  const observationByProductId = new Map<string, RawProductObservation>()
  const duplicateProductIds = new Set<string>()

  for (const pair of candidatePairs) {
    if (observationByProductId.has(pair.candidate.id)) {
      duplicateProductIds.add(pair.candidate.id)
    } else {
      observationByProductId.set(pair.candidate.id, pair.observation)
    }
  }

  const ingredients = aggregateIngredients(plan, activeDays, recipes)
  const lines: M2BasketLine[] = ingredients.map((ingredient) => {
    const match = matchIngredient(ingredient, candidates)
    if (match.type === 'abstain') {
      return unresolved(ingredient, match, match.reasons)
    }

    if (duplicateProductIds.has(match.productId)) {
      return unresolved(ingredient, match, [
        ...match.reasons,
        'matched product has duplicate observations',
      ])
    }

    const observation = observationByProductId.get(match.productId) ?? null
    if (!observation) {
      return unresolved(ingredient, match, [
        ...match.reasons,
        'matched product observation missing',
      ])
    }

    if (observation.currentPriceCents === null) {
      return unresolved(
        ingredient,
        match,
        [...match.reasons, 'matched product price unknown'],
        observation,
      )
    }

    if (ingredient.amount === null || observation.pack.amount === null) {
      return unresolved(
        ingredient,
        match,
        [...match.reasons, 'basket quantity cannot be calculated'],
        observation,
      )
    }

    const required = toBaseQuantity(ingredient.amount, ingredient.unit)
    const pack = toBaseQuantity(
      observation.pack.amount,
      observationUnit(observation.pack.unit),
    )

    if (!required || !pack || required.family !== pack.family) {
      return unresolved(
        ingredient,
        match,
        [...match.reasons, 'basket quantity unit family unresolved'],
        observation,
      )
    }

    const packs = Math.ceil(required.amount / pack.amount)
    if (!Number.isSafeInteger(packs) || packs <= 0) {
      return unresolved(
        ingredient,
        match,
        [...match.reasons, 'calculated pack count invalid'],
        observation,
      )
    }

    const warnings: string[] = []
    if (observation.availability === 'unknown') {
      warnings.push('availability unknown in bounded source evidence')
    }
    if (observation.offer) {
      warnings.push('price comes from observed offer evidence')
    }

    return {
      status: 'matched',
      ingredient,
      product: observation,
      packs,
      linePriceCents: packs * observation.currentPriceCents,
      trace: {
        match,
        sourceProductId: observation.sourceProductId,
        provenance: observation.provenance,
        warnings,
      },
    }
  })

  return {
    supermarket,
    activeDays: [...activeDays],
    lines,
    totalCents: lines.reduce(
      (total, line) =>
        line.status === 'matched' ? total + line.linePriceCents : total,
      0,
    ),
    complete: lines.every((line) => line.status === 'matched'),
  }
}

function requirementText(ingredient: AggregatedIngredientRequirement): string {
  if (ingredient.amount === null) return ingredient.label
  const unit = ingredient.unit === 'piece' ? 'st' : ingredient.unit
  return `${ingredient.amount} ${unit}`
}

export function shoppingListFromBasket(
  basket: SingleStoreBasket,
): ShoppingListItem[] {
  return basket.lines.map((line) => {
    if (line.status === 'unresolved') {
      return {
        id: `review-${line.ingredient.id}`,
        label: line.ingredient.label,
        quantity: requirementText(line.ingredient),
        priceCents: null,
        needsReview: true,
        trace: [
          'Geen betrouwbaar product gekozen.',
          ...line.trace.match.reasons,
          ...line.trace.warnings,
        ],
      }
    }

    const packLabel =
      line.product.pack.rawText ??
      (line.product.pack.amount === null
        ? 'onbekende verpakking'
        : `${line.product.pack.amount} ${line.product.pack.unit}`)

    return {
      id: `${basket.supermarket}-${line.product.sourceProductId ?? line.ingredient.id}`,
      label: line.product.name,
      quantity: `${line.packs} × ${packLabel}`,
      priceCents: line.linePriceCents,
      needsReview: line.trace.warnings.length > 0,
      trace: [
        `${line.ingredient.label}: ${requirementText(line.ingredient)}`,
        ...line.trace.match.reasons,
        ...line.trace.warnings,
      ],
    }
  })
}
