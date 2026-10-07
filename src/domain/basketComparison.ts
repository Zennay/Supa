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

function baseQuantity(
  amount: number,
  unit: MatchedBasketLine['requirement']['unit'],
): { amount: number; family: 'mass' | 'volume' | 'piece' } | null {
  if (!Number.isFinite(amount) || amount <= 0) return null

  if (unit === 'kg') {
    const converted = amount * 1000
    return Number.isFinite(converted) && converted > 0
      ? { amount: converted, family: 'mass' }
      : null
  }
  if (unit === 'g') return { amount, family: 'mass' }
  if (unit === 'l') {
    const converted = amount * 1000
    return Number.isFinite(converted) && converted > 0
      ? { amount: converted, family: 'volume' }
      : null
  }
  if (unit === 'ml') return { amount, family: 'volume' }
  if (unit === 'piece') return { amount, family: 'piece' }
  return null
}

function validIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function canonicalIdentity(value: unknown): value is string {
  return validIdentity(value) && value === value.trim()
}

function supportedBasketLine(line: unknown): line is BasketTraceLine {
  if (line === null || typeof line !== 'object' || !('status' in line)) {
    return false
  }

  const status = (line as { status?: unknown }).status
  return status === 'matched' || status === 'unresolved'
}

function basketLines(basket: OneStoreBasket): BasketTraceLine[] {
  if (!Array.isArray(basket.lines)) return []
  return basket.lines.filter(supportedBasketLine)
}

function invalidMatchedLineIdentity(line: MatchedBasketLine): boolean {
  return (
    !validIdentity(line.id) ||
    !validIdentity(line.ingredientLabel) ||
    !validIdentity(line.productId) ||
    !validIdentity(line.productName)
  )
}

function invalidMatchedLineEconomics(line: MatchedBasketLine): boolean {
  const effectivePackAmount = line.pack.amount * line.pack.count
  const required = baseQuantity(line.requirement.amount, line.requirement.unit)
  const pack = baseQuantity(effectivePackAmount, line.pack.unit)
  const expectedPacks =
    required && pack && required.family === pack.family
      ? Math.ceil(required.amount / pack.amount)
      : null
  const expectedLineTotalCents = line.packs * line.pricePerPackCents

  return (
    !Number.isSafeInteger(line.pack.count) ||
    line.pack.count <= 0 ||
    !Number.isSafeInteger(line.packs) ||
    line.packs <= 0 ||
    !Number.isSafeInteger(line.pricePerPackCents) ||
    line.pricePerPackCents < 0 ||
    !Number.isFinite(effectivePackAmount) ||
    effectivePackAmount <= 0 ||
    expectedPacks === null ||
    !Number.isSafeInteger(expectedPacks) ||
    expectedPacks <= 0 ||
    expectedPacks !== line.packs ||
    !Number.isSafeInteger(expectedLineTotalCents) ||
    expectedLineTotalCents !== line.lineTotalCents ||
    !Number.isSafeInteger(line.matchScore) ||
    line.matchScore < 65 ||
    line.matchScore > 110
  )
}

function inspectBasket(label: string, basket: OneStoreBasket): string[] {
  const reasons: string[] = []
  const rawLines: unknown[] = Array.isArray(basket.lines) ? basket.lines : []
  const lines = rawLines.filter(supportedBasketLine)
  const ids = lines.map((line) => line.id)
  const matched = lines.filter(
    (line): line is MatchedBasketLine => line.status === 'matched',
  )
  const unresolved = lines.filter((line) => line.status === 'unresolved')

  if (!Array.isArray(basket.lines)) {
    reasons.push(`${label} basket lines are not an array`)
  } else if (rawLines.some((line) => !supportedBasketLine(line))) {
    reasons.push(`${label} basket contains an unsupported line shape or status`)
  }

  if (!canonicalIdentity(basket.store.id)) {
    reasons.push(`${label} basket has an invalid store identity`)
  }

  if (new Set(ids).size !== ids.length) {
    reasons.push(`${label} basket contains duplicate ingredient ids`)
  }

  if (matched.some(invalidMatchedLineIdentity)) {
    reasons.push(`${label} basket contains invalid matched-line identity`)
  }

  if (
    !Number.isSafeInteger(basket.selectedMealCount) ||
    basket.selectedMealCount < 0
  ) {
    reasons.push(`${label} basket has an invalid selected meal count`)
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

  if (
    typeof baseline.store.id === 'string' &&
    typeof candidate.store.id === 'string' &&
    baseline.store.id.trim() === candidate.store.id.trim()
  ) {
    reasons.push('baseline and candidate stores must differ')
  }

  if (baseline.selectedMealCount !== candidate.selectedMealCount) {
    reasons.push('basket plans select a different number of meals')
  }

  const baselineMatched = basketLines(baseline).filter(
    (line): line is MatchedBasketLine => line.status === 'matched',
  )
  const candidateMatched = basketLines(candidate).filter(
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
