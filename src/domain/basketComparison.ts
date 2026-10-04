import type { BasketTraceLine, OneStoreBasket } from './basket.ts'

type MatchedBasketLine = Extract<BasketTraceLine, { status: 'matched' }>

export type BasketComparisonOutcome =
  | 'better'
  | 'same'
  | 'worse'
  | 'unknown'

export type BasketLineDelta = {
  id: string
  ingredientLabel: string
  baselineLineTotalCents: number
  candidateLineTotalCents: number
  deltaCents: number
}

export type BasketEffectAttribution =
  | {
      status: 'known'
      deltaCents: number
      reasons: string[]
    }
  | {
      status: 'unknown'
      deltaCents: null
      reasons: string[]
    }

export type BasketComparisonAttribution = {
  planning: BasketEffectAttribution
  packSize: BasketEffectAttribution
  offer: BasketEffectAttribution
  unattributedCents: number | null
}

export type BasketComparison = {
  outcome: BasketComparisonOutcome
  claimable: boolean
  baselineTotalCents: number
  candidateTotalCents: number
  deltaCents: number | null
  savingsCents: number | null
  lineDeltas: BasketLineDelta[]
  attribution: BasketComparisonAttribution
  reasons: string[]
}

function inspectBasket(label: string, basket: OneStoreBasket): string[] {
  const reasons: string[] = []
  const ids = basket.lines.map((line) => line.id)
  const matched = basket.lines.filter(
    (line): line is MatchedBasketLine => line.status === 'matched',
  )
  const unresolved = basket.lines.filter((line) => line.status === 'unresolved')

  if (new Set(ids).size !== ids.length) {
    reasons.push(`${label} basket contains duplicate ingredient ids`)
  }

  if (
    !Number.isInteger(basket.totalCents) ||
    basket.totalCents < 0 ||
    matched.some(
      (line) =>
        !Number.isInteger(line.lineTotalCents) || line.lineTotalCents < 0,
    )
  ) {
    reasons.push(`${label} basket contains an invalid monetary value`)
  }

  const calculatedTotal = matched.reduce(
    (total, line) => total + line.lineTotalCents,
    0,
  )
  if (calculatedTotal !== basket.totalCents) {
    reasons.push(`${label} basket total does not match its line totals`)
  }

  if (
    basket.matchedLineCount !== matched.length ||
    basket.unresolvedLineCount !== unresolved.length
  ) {
    reasons.push(`${label} basket line counters are inconsistent`)
  }

  if (unresolved.length > 0) {
    reasons.push(
      `${label} basket has unresolved ingredients: ${unresolved
        .map((line) => line.id)
        .sort()
        .join(', ')}`,
    )
  }

  return reasons
}

function unknownEffect(reason: string): BasketEffectAttribution {
  return {
    status: 'unknown',
    deltaCents: null,
    reasons: [reason],
  }
}

function unknownAttribution(reason: string): BasketComparisonAttribution {
  return {
    planning: unknownEffect(reason),
    packSize: unknownEffect(reason),
    offer: unknownEffect(reason),
    unattributedCents: null,
  }
}

function samePackGeometry(
  baselineLine: MatchedBasketLine,
  candidateLine: MatchedBasketLine,
) {
  return (
    baselineLine.pack.amount === candidateLine.pack.amount &&
    baselineLine.pack.unit === candidateLine.pack.unit &&
    baselineLine.pack.count === candidateLine.pack.count &&
    baselineLine.packs === candidateLine.packs
  )
}

function buildClaimableAttribution(
  baselineById: Map<string, MatchedBasketLine>,
  candidateById: Map<string, MatchedBasketLine>,
  deltaCents: number,
): BasketComparisonAttribution {
  const differingPackIds: string[] = []

  for (const [id, baselineLine] of baselineById) {
    const candidateLine = candidateById.get(id)
    if (!candidateLine || !samePackGeometry(baselineLine, candidateLine)) {
      differingPackIds.push(id)
    }
  }

  return {
    planning: {
      status: 'known',
      deltaCents: 0,
      reasons: ['comparison contract requires identical ingredient demand'],
    },
    packSize:
      differingPackIds.length === 0
        ? {
            status: 'known',
            deltaCents: 0,
            reasons: ['all compared lines use identical pack geometry and pack counts'],
          }
        : unknownEffect(
            `pack-size effect cannot be isolated from price for: ${differingPackIds
              .sort()
              .join(', ')}`,
          ),
    offer: unknownEffect(
      'basket trace does not distinguish promotional price from regular price',
    ),
    unattributedCents: deltaCents,
  }
}

function unknownComparison(
  baseline: OneStoreBasket,
  candidate: OneStoreBasket,
  reasons: string[],
): BasketComparison {
  const uniqueReasons = [...new Set(reasons)]
  return {
    outcome: 'unknown',
    claimable: false,
    baselineTotalCents: baseline.totalCents,
    candidateTotalCents: candidate.totalCents,
    deltaCents: null,
    savingsCents: null,
    lineDeltas: [],
    attribution: unknownAttribution(
      'effect attribution is unavailable because the basket comparison is not claimable',
    ),
    reasons: uniqueReasons,
  }
}

export function compareFullBaskets({
  baseline,
  candidate,
}: {
  baseline: OneStoreBasket
  candidate: OneStoreBasket
}): BasketComparison {
  const reasons = [
    ...inspectBasket('baseline', baseline),
    ...inspectBasket('candidate', candidate),
  ]

  if (baseline.selectedMealCount !== candidate.selectedMealCount) {
    reasons.push('basket plans select a different number of meals')
  }

  const baselineMatched = baseline.lines.filter(
    (line): line is MatchedBasketLine => line.status === 'matched',
  )
  const candidateMatched = candidate.lines.filter(
    (line): line is MatchedBasketLine => line.status === 'matched',
  )

  const baselineById = new Map(
    baselineMatched.map((line) => [line.id, line] as const),
  )
  const candidateById = new Map(
    candidateMatched.map((line) => [line.id, line] as const),
  )

  if (baselineById.size !== candidateById.size) {
    reasons.push('basket ingredient coverage differs')
  }

  const lineDeltas: BasketLineDelta[] = []
  for (const [id, baselineLine] of baselineById) {
    const candidateLine = candidateById.get(id)
    if (!candidateLine) {
      reasons.push(`candidate basket is missing ingredient ${id}`)
      continue
    }

    if (
      baselineLine.requirement.amount !== candidateLine.requirement.amount ||
      baselineLine.requirement.unit !== candidateLine.requirement.unit
    ) {
      reasons.push(`ingredient demand differs for ${id}`)
      continue
    }

    lineDeltas.push({
      id,
      ingredientLabel: baselineLine.ingredientLabel,
      baselineLineTotalCents: baselineLine.lineTotalCents,
      candidateLineTotalCents: candidateLine.lineTotalCents,
      deltaCents:
        candidateLine.lineTotalCents - baselineLine.lineTotalCents,
    })
  }

  for (const id of candidateById.keys()) {
    if (!baselineById.has(id)) {
      reasons.push(`candidate basket has extra ingredient ${id}`)
    }
  }

  if (reasons.length > 0) {
    return unknownComparison(baseline, candidate, reasons)
  }

  const deltaCents = candidate.totalCents - baseline.totalCents
  const outcome: BasketComparisonOutcome =
    deltaCents < 0 ? 'better' : deltaCents > 0 ? 'worse' : 'same'

  return {
    outcome,
    claimable: true,
    baselineTotalCents: baseline.totalCents,
    candidateTotalCents: candidate.totalCents,
    deltaCents,
    savingsCents: deltaCents === 0 ? 0 : -deltaCents,
    lineDeltas,
    attribution: buildClaimableAttribution(
      baselineById,
      candidateById,
      deltaCents,
    ),
    reasons: [],
  }
}
