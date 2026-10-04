import type { BasketTraceLine, OneStoreBasket } from './basket.ts'

type MatchedBasketLine = Extract<BasketTraceLine, { status: 'matched' }>

export type BasketComparisonOutcome =
  | 'better'
  | 'same'
  | 'worse'
  | 'unknown'

export type BasketEffectAttribution = {
  packSizeCents: number
  offerCents: number
  planningCents: number
  unknownCents: number
  fullyAttributed: boolean
  notes: string[]
}

export type BasketLineDelta = {
  id: string
  ingredientLabel: string
  baselineLineTotalCents: number
  candidateLineTotalCents: number
  deltaCents: number
  attribution: BasketEffectAttribution
}

export type BasketComparison = {
  outcome: BasketComparisonOutcome
  claimable: boolean
  baselineTotalCents: number
  candidateTotalCents: number
  deltaCents: number | null
  savingsCents: number | null
  lineDeltas: BasketLineDelta[]
  attribution: BasketEffectAttribution | null
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
    attribution: null,
    reasons: [...new Set(reasons)],
  }
}

function packBase(
  line: MatchedBasketLine,
): { amount: number; family: 'mass' | 'volume' | 'piece' } | null {
  const amount = line.pack.amount * line.pack.count
  if (!Number.isFinite(amount) || amount <= 0) return null

  if (line.pack.unit === 'kg') {
    return { amount: amount * 1000, family: 'mass' }
  }
  if (line.pack.unit === 'g') return { amount, family: 'mass' }
  if (line.pack.unit === 'l') {
    return { amount: amount * 1000, family: 'volume' }
  }
  if (line.pack.unit === 'ml') return { amount, family: 'volume' }
  if (line.pack.unit === 'piece') return { amount, family: 'piece' }
  return null
}

function regularPriceCents(line: MatchedBasketLine): number | null {
  if (line.pricing.kind === 'unknown') return null
  return line.pricing.regularPriceCents
}

function offerEffectCents(line: MatchedBasketLine): number | null {
  const regular = regularPriceCents(line)
  if (regular === null) return null
  return line.packs * (line.pricePerPackCents - regular)
}

function sameRegularUnitPrice(
  baseline: MatchedBasketLine,
  candidate: MatchedBasketLine,
): boolean {
  const baselineRegular = regularPriceCents(baseline)
  const candidateRegular = regularPriceCents(candidate)
  const baselinePack = packBase(baseline)
  const candidatePack = packBase(candidate)

  if (
    baselineRegular === null ||
    candidateRegular === null ||
    !baselinePack ||
    !candidatePack ||
    baselinePack.family !== candidatePack.family
  ) {
    return false
  }

  const baselineRate = baselineRegular / baselinePack.amount
  const candidateRate = candidateRegular / candidatePack.amount
  return Math.abs(baselineRate - candidateRate) < 1e-9
}

function attributeLine(
  baseline: MatchedBasketLine,
  candidate: MatchedBasketLine,
): BasketEffectAttribution {
  const deltaCents = candidate.lineTotalCents - baseline.lineTotalCents
  const notes: string[] = []
  let packSizeCents = 0
  let offerCents = 0
  let unknownCents = deltaCents
  let packKnown = false
  let offerKnown = false

  const baselineOffer = offerEffectCents(baseline)
  const candidateOffer = offerEffectCents(candidate)
  if (baselineOffer !== null && candidateOffer !== null) {
    offerCents = candidateOffer - baselineOffer
    unknownCents -= offerCents
    offerKnown = true
  } else {
    notes.push('offer effect unknown because regular-price context is missing')
  }

  const baselineRegular = regularPriceCents(baseline)
  const candidateRegular = regularPriceCents(candidate)
  if (
    baselineRegular !== null &&
    candidateRegular !== null &&
    sameRegularUnitPrice(baseline, candidate)
  ) {
    packSizeCents =
      candidate.packs * candidateRegular -
      baseline.packs * baselineRegular
    unknownCents -= packSizeCents
    packKnown = true
  } else {
    notes.push(
      'pack-size effect unknown because comparable regular unit prices are missing',
    )
  }

  const fullyAttributed = packKnown && offerKnown && unknownCents === 0
  if (!fullyAttributed && unknownCents !== 0) {
    notes.push(
      'remaining delta can include regular-price or other unmodelled effects',
    )
  }

  return {
    packSizeCents,
    offerCents,
    planningCents: 0,
    unknownCents,
    fullyAttributed,
    notes: [...new Set(notes)],
  }
}

function summarizeAttribution(
  lineDeltas: BasketLineDelta[],
): BasketEffectAttribution {
  const totals = lineDeltas.reduce(
    (sum, line) => ({
      packSizeCents: sum.packSizeCents + line.attribution.packSizeCents,
      offerCents: sum.offerCents + line.attribution.offerCents,
      planningCents: sum.planningCents + line.attribution.planningCents,
      unknownCents: sum.unknownCents + line.attribution.unknownCents,
    }),
    {
      packSizeCents: 0,
      offerCents: 0,
      planningCents: 0,
      unknownCents: 0,
    },
  )

  return {
    ...totals,
    fullyAttributed: lineDeltas.every(
      (line) => line.attribution.fullyAttributed,
    ),
    notes: [
      ...new Set(lineDeltas.flatMap((line) => line.attribution.notes)),
    ],
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
      attribution: attributeLine(baselineLine, candidateLine),
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
    attribution: summarizeAttribution(lineDeltas),
    reasons: [],
  }
}
