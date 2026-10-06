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

export type BasketComparison = {
  outcome: BasketComparisonOutcome
  claimable: boolean
  baselineTotalCents: number
  candidateTotalCents: number
  deltaCents: number | null
  savingsCents: number | null
  lineDeltas: BasketLineDelta[]
  reasons: string[]
}

function invalidMatchedLineEconomics(line: MatchedBasketLine): boolean {
  const effectivePackAmount = line.pack.amount * line.pack.count
  const expectedLineTotalCents = line.packs * line.pricePerPackCents

  return (
    !Number.isFinite(line.requirement.amount) ||
    line.requirement.amount <= 0 ||
    !Number.isFinite(line.pack.amount) ||
    line.pack.amount <= 0 ||
    !Number.isSafeInteger(line.pack.count) ||
    line.pack.count <= 0 ||
    !Number.isSafeInteger(line.packs) ||
    line.packs <= 0 ||
    !Number.isSafeInteger(line.pricePerPackCents) ||
    line.pricePerPackCents < 0 ||
    !Number.isFinite(effectivePackAmount) ||
    effectivePackAmount <= 0 ||
    !Number.isSafeInteger(expectedLineTotalCents) ||
    expectedLineTotalCents !== line.lineTotalCents ||
    !Number.isFinite(line.matchScore)
  )
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
    !Number.isSafeInteger(basket.totalCents) ||
    basket.totalCents < 0 ||
    matched.some(
      (line) =>
        !Number.isSafeInteger(line.lineTotalCents) || line.lineTotalCents < 0,
    )
  ) {
    reasons.push(`${label} basket contains an invalid monetary value`)
  }

  if (matched.some(invalidMatchedLineEconomics)) {
    reasons.push(`${label} basket contains invalid matched-line economics`)
  }

  const calculatedTotal = matched.reduce(
    (total, line) => total + line.lineTotalCents,
    0,
  )
  if (!Number.isSafeInteger(calculatedTotal)) {
    reasons.push(`${label} basket monetary total exceeds safe integer range`)
  }
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

function unknownComparison(
  baseline: OneStoreBasket,
  candidate: OneStoreBasket,
  reasons: string[],
): BasketComparison {
  return {
    outcome: 'unknown',
    claimable: false,
    baselineTotalCents: baseline.totalCents,
    candidateTotalCents: candidate.totalCents,
    deltaCents: null,
    savingsCents: null,
    lineDeltas: [],
    reasons: [...new Set(reasons)],
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

  if (baseline.store.id === candidate.store.id) {
    reasons.push('baseline and candidate stores must differ')
  }

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

    if (baselineLine.ingredientLabel !== candidateLine.ingredientLabel) {
      reasons.push(`ingredient label differs for ${id}`)
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
    reasons: [],
  }
}
