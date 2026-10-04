import type { BasketComparison } from './basketComparison.ts'

export type SavingsEffect = 'pack-size' | 'offer' | 'planning'

export type SavingsAttributionEvidence = {
  lineId: string
  effect: SavingsEffect
  deltaCents: number
  evidenceRef: string
}

export type SavingsEffectTotals = {
  packSizeCents: number
  offerCents: number
  planningCents: number
  unknownCents: number | null
}

export type SavingsAttribution = {
  status: 'complete' | 'partial' | 'unknown'
  fullyAttributed: boolean
  comparisonDeltaCents: number | null
  effectTotals: SavingsEffectTotals
  reasons: string[]
}

function emptyTotals(): SavingsEffectTotals {
  return {
    packSizeCents: 0,
    offerCents: 0,
    planningCents: 0,
    unknownCents: null,
  }
}

function effectKey(effect: SavingsEffect): keyof Omit<SavingsEffectTotals, 'unknownCents'> {
  if (effect === 'pack-size') return 'packSizeCents'
  if (effect === 'offer') return 'offerCents'
  return 'planningCents'
}

export function attributeSavingsEffects({
  comparison,
  evidence,
}: {
  comparison: BasketComparison
  evidence: SavingsAttributionEvidence[]
}): SavingsAttribution {
  if (!comparison.claimable || comparison.deltaCents === null) {
    return {
      status: 'unknown',
      fullyAttributed: false,
      comparisonDeltaCents: null,
      effectTotals: emptyTotals(),
      reasons: [
        'basket comparison is not claimable',
        ...comparison.reasons,
      ],
    }
  }

  const lineById = new Map(comparison.lineDeltas.map((line) => [line.id, line] as const))
  const reasons: string[] = []
  const evidenceByLine = new Map<string, SavingsAttributionEvidence[]>()

  for (const item of evidence) {
    if (!lineById.has(item.lineId)) {
      reasons.push(`attribution references unknown comparison line ${item.lineId}`)
      continue
    }

    if (!Number.isInteger(item.deltaCents)) {
      reasons.push(`attribution for ${item.lineId} must use integer cents`)
      continue
    }

    if (item.evidenceRef.trim().length === 0) {
      reasons.push(`attribution for ${item.lineId} is missing an evidence reference`)
      continue
    }

    const lineDelta = lineById.get(item.lineId)!.deltaCents
    if (
      (lineDelta > 0 && item.deltaCents < 0) ||
      (lineDelta < 0 && item.deltaCents > 0) ||
      (lineDelta === 0 && item.deltaCents !== 0)
    ) {
      reasons.push(`attribution direction conflicts with line delta for ${item.lineId}`)
      continue
    }

    const current = evidenceByLine.get(item.lineId) ?? []
    current.push(item)
    evidenceByLine.set(item.lineId, current)
  }

  if (reasons.length > 0) {
    return {
      status: 'unknown',
      fullyAttributed: false,
      comparisonDeltaCents: comparison.deltaCents,
      effectTotals: emptyTotals(),
      reasons: [...new Set(reasons)],
    }
  }

  const effectTotals: SavingsEffectTotals = {
    packSizeCents: 0,
    offerCents: 0,
    planningCents: 0,
    unknownCents: 0,
  }
  let hasUnknownRemainder = false

  for (const line of comparison.lineDeltas) {
    const lineEvidence = evidenceByLine.get(line.id) ?? []
    const attributedForLine = lineEvidence.reduce(
      (total, item) => total + item.deltaCents,
      0,
    )

    if (
      (line.deltaCents > 0 && attributedForLine > line.deltaCents) ||
      (line.deltaCents < 0 && attributedForLine < line.deltaCents) ||
      (line.deltaCents === 0 && attributedForLine !== 0)
    ) {
      reasons.push(`attribution exceeds line delta for ${line.id}`)
      continue
    }

    for (const item of lineEvidence) {
      effectTotals[effectKey(item.effect)] += item.deltaCents
    }

    const unknownRemainder = line.deltaCents - attributedForLine
    effectTotals.unknownCents! += unknownRemainder
    if (unknownRemainder !== 0) {
      hasUnknownRemainder = true
    }
  }

  if (reasons.length > 0) {
    return {
      status: 'unknown',
      fullyAttributed: false,
      comparisonDeltaCents: comparison.deltaCents,
      effectTotals: emptyTotals(),
      reasons: [...new Set(reasons)],
    }
  }

  const knownTotal =
    effectTotals.packSizeCents +
    effectTotals.offerCents +
    effectTotals.planningCents
  const accountedTotal = knownTotal + effectTotals.unknownCents!

  if (accountedTotal !== comparison.deltaCents) {
    return {
      status: 'unknown',
      fullyAttributed: false,
      comparisonDeltaCents: comparison.deltaCents,
      effectTotals: emptyTotals(),
      reasons: ['attribution does not reconcile to the full basket delta'],
    }
  }

  return {
    status: hasUnknownRemainder ? 'partial' : 'complete',
    fullyAttributed: !hasUnknownRemainder,
    comparisonDeltaCents: comparison.deltaCents,
    effectTotals,
    reasons: hasUnknownRemainder
      ? ['one or more line deltas remain unattributed']
      : [],
  }
}
