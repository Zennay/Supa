import type { OneStoreBasket } from './basket.ts'

export type SavingsDirection = 'cheaper' | 'same' | 'worse' | 'unknown'

export type SavingsEffectInput = {
  packSizeCents?: number | null
  offerCents?: number | null
  planningCents?: number | null
}

export type SavingsEffects = {
  packSizeCents: number | null
  offerCents: number | null
  planningCents: number | null
  unexplainedCents: number | null
}

export type BasketComparison = {
  baselineStoreId: string
  candidateStoreId: string
  selectedMealCount: number | null
  baselineMatchedSubtotalCents: number
  candidateMatchedSubtotalCents: number
  deltaCents: number | null
  savingsRate: number | null
  direction: SavingsDirection
  claimable: boolean
  reasons: string[]
  effects: SavingsEffects
}

function integerEffect(value: number | null | undefined, label: string) {
  if (value === undefined || value === null) return null
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be integer cents or null`)
  }
  return value
}

function validateBasket(basket: OneStoreBasket, side: 'baseline' | 'candidate') {
  const reasons: string[] = []
  const ids = new Set<string>()
  let matched = 0
  let unresolved = 0
  let matchedSubtotal = 0

  for (const line of basket.lines) {
    if (ids.has(line.id)) {
      reasons.push(`${side} has duplicate ingredient line: ${line.id}`)
    }
    ids.add(line.id)

    if (line.status === 'unresolved') {
      unresolved += 1
      reasons.push(`${side} unresolved ingredient: ${line.id}`)
      continue
    }

    matched += 1
    if (
      !Number.isInteger(line.packs) ||
      line.packs <= 0 ||
      !Number.isInteger(line.pricePerPackCents) ||
      line.pricePerPackCents < 0 ||
      !Number.isInteger(line.lineTotalCents) ||
      line.lineTotalCents < 0 ||
      line.lineTotalCents !== line.packs * line.pricePerPackCents
    ) {
      reasons.push(`${side} has invalid matched-line money/pack trace: ${line.id}`)
      continue
    }
    matchedSubtotal += line.lineTotalCents
  }

  if (basket.matchedLineCount !== matched) {
    reasons.push(`${side} matchedLineCount does not match trace lines`)
  }
  if (basket.unresolvedLineCount !== unresolved) {
    reasons.push(`${side} unresolvedLineCount does not match trace lines`)
  }
  if (!Number.isInteger(basket.totalCents) || basket.totalCents < 0) {
    reasons.push(`${side} basket total is not trusted integer cents`)
  } else if (basket.totalCents !== matchedSubtotal) {
    reasons.push(`${side} basket total does not equal matched line trace`)
  }

  return reasons
}

function compareRequirements(
  baseline: OneStoreBasket,
  candidate: OneStoreBasket,
) {
  const reasons: string[] = []
  const baselineById = new Map(baseline.lines.map((line) => [line.id, line]))
  const candidateById = new Map(candidate.lines.map((line) => [line.id, line]))
  const ids = [...new Set([...baselineById.keys(), ...candidateById.keys()])].sort()

  for (const id of ids) {
    const baselineLine = baselineById.get(id)
    const candidateLine = candidateById.get(id)
    if (!baselineLine || !candidateLine) {
      reasons.push(`basket requirement set differs at ingredient: ${id}`)
      continue
    }

    if (
      baselineLine.ingredientLabel !== candidateLine.ingredientLabel ||
      baselineLine.requirement.amount !== candidateLine.requirement.amount ||
      baselineLine.requirement.unit !== candidateLine.requirement.unit
    ) {
      reasons.push(`basket requirement differs at ingredient: ${id}`)
    }
  }

  return reasons
}

export function compareStoreBaskets({
  baseline,
  candidate,
  effects = {},
}: {
  baseline: OneStoreBasket
  candidate: OneStoreBasket
  effects?: SavingsEffectInput
}): BasketComparison {
  const reasons = [
    ...validateBasket(baseline, 'baseline'),
    ...validateBasket(candidate, 'candidate'),
    ...compareRequirements(baseline, candidate),
  ]

  if (baseline.store.id === candidate.store.id) {
    reasons.push('baseline and candidate store must differ')
  }
  if (baseline.selectedMealCount !== candidate.selectedMealCount) {
    reasons.push('selected meal count differs between baskets')
  }

  const packSizeCents = integerEffect(effects.packSizeCents, 'packSizeCents')
  const offerCents = integerEffect(effects.offerCents, 'offerCents')
  const planningCents = integerEffect(effects.planningCents, 'planningCents')

  const claimable = reasons.length === 0
  const deltaCents = claimable ? baseline.totalCents - candidate.totalCents : null
  const savingsRate =
    deltaCents !== null && baseline.totalCents > 0
      ? deltaCents / baseline.totalCents
      : null

  const knownEffects = [packSizeCents, offerCents, planningCents].reduce(
    (sum, value) => sum + (value ?? 0),
    0,
  )

  let direction: SavingsDirection = 'unknown'
  if (deltaCents !== null) {
    direction =
      deltaCents > 0 ? 'cheaper' : deltaCents < 0 ? 'worse' : 'same'
  }

  return {
    baselineStoreId: baseline.store.id,
    candidateStoreId: candidate.store.id,
    selectedMealCount:
      baseline.selectedMealCount === candidate.selectedMealCount
        ? baseline.selectedMealCount
        : null,
    baselineMatchedSubtotalCents: baseline.totalCents,
    candidateMatchedSubtotalCents: candidate.totalCents,
    deltaCents,
    savingsRate,
    direction,
    claimable,
    reasons,
    effects: {
      packSizeCents,
      offerCents,
      planningCents,
      unexplainedCents: deltaCents === null ? null : deltaCents - knownEffects,
    },
  }
}
