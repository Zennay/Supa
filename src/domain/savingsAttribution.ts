import type { BasketComparison } from './basketComparison.ts'

export type SavingsEffect = 'pack-size' | 'offer' | 'planning'

const SAVINGS_EFFECTS = new Set<SavingsEffect>(['pack-size', 'offer', 'planning'])

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
  evidence: unknown
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

  if (!Array.isArray(evidence)) {
    return {
      status: 'unknown',
      fullyAttributed: false,
      comparisonDeltaCents: comparison.deltaCents,
      effectTotals: emptyTotals(),
      reasons: ['attribution evidence must be an array'],
    }
  }

  const comparisonLineIds = new Set<string>()
  for (const line of comparison.lineDeltas) {
    if (
      typeof line.id !== 'string' ||
      line.id.trim().length === 0 ||
      line.id.trim() !== line.id
    ) {
      return {
        status: 'unknown',
        fullyAttributed: false,
        comparisonDeltaCents: comparison.deltaCents,
        effectTotals: emptyTotals(),
        reasons: ['basket comparison contains an invalid line identity'],
      }
    }
    if (comparisonLineIds.has(line.id)) {
      return {
        status: 'unknown',
        fullyAttributed: false,
        comparisonDeltaCents: comparison.deltaCents,
        effectTotals: emptyTotals(),
        reasons: [`basket comparison contains duplicate line identity ${line.id}`],
      }
    }
    comparisonLineIds.add(line.id)
  }

  const lineById = new Map(comparison.lineDeltas.map((line) => [line.id, line] as const))
  const reasons: string[] = []
  const evidenceByLine = new Map<string, SavingsAttributionEvidence[]>()
  const seenEvidenceItems = new Set<string>()

  for (const rawItem of evidence) {
    if (!rawItem || typeof rawItem !== 'object') {
      reasons.push('attribution evidence item must be an object')
      continue
    }

    const item = rawItem as Partial<SavingsAttributionEvidence>

    if (typeof item.lineId !== 'string' || item.lineId.trim().length === 0) {
      reasons.push('attribution evidence lineId must be a non-empty string')
      continue
    }
    if (item.lineId.trim() !== item.lineId) {
      reasons.push('attribution evidence lineId must be a canonical non-empty string')
      continue
    }

    if (!lineById.has(item.lineId)) {
      reasons.push(`attribution references unknown comparison line ${item.lineId}`)
      continue
    }

    if (!SAVINGS_EFFECTS.has(item.effect as SavingsEffect)) {
      reasons.push(`attribution for ${item.lineId} has an unsupported effect`)
      continue
    }

    if (!Number.isSafeInteger(item.deltaCents)) {
      reasons.push(`attribution for ${item.lineId} must use safe integer cents`)
      continue
    }

    if (
      typeof item.evidenceRef !== 'string' ||
      item.evidenceRef.trim().length === 0
    ) {
      reasons.push(`attribution for ${item.lineId} is missing an evidence reference`)
      continue
    }
    if (item.evidenceRef.trim() !== item.evidenceRef) {
      reasons.push(`attribution for ${item.lineId} must use a canonical evidence reference`)
      continue
    }

    const validatedItem = item as SavingsAttributionEvidence
    const evidenceKey = [
      validatedItem.lineId,
      validatedItem.effect,
      validatedItem.evidenceRef.trim(),
    ].join('\u0000')
    if (seenEvidenceItems.has(evidenceKey)) {
      reasons.push(`duplicate attribution evidence for ${validatedItem.lineId}`)
      continue
    }
    seenEvidenceItems.add(evidenceKey)

    if (validatedItem.effect === 'planning' && validatedItem.deltaCents !== 0) {
      reasons.push(
        `planning attribution must be zero for same-demand basket comparisons: ${validatedItem.lineId}`,
      )
      continue
    }

    const lineDelta = lineById.get(validatedItem.lineId)!.deltaCents
    if (
      (lineDelta > 0 && validatedItem.deltaCents < 0) ||
      (lineDelta < 0 && validatedItem.deltaCents > 0) ||
      (lineDelta === 0 && validatedItem.deltaCents !== 0)
    ) {
      reasons.push(
        `attribution direction conflicts with line delta for ${validatedItem.lineId}`,
      )
      continue
    }

    const current = evidenceByLine.get(validatedItem.lineId) ?? []
    current.push(validatedItem)
    evidenceByLine.set(validatedItem.lineId, current)
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

    if (!Number.isSafeInteger(attributedForLine)) {
      reasons.push(`attribution total exceeds safe integer cents for ${line.id}`)
      continue
    }

    if (
      (line.deltaCents > 0 && attributedForLine > line.deltaCents) ||
      (line.deltaCents < 0 && attributedForLine < line.deltaCents) ||
      (line.deltaCents === 0 && attributedForLine !== 0)
    ) {
      reasons.push(`attribution exceeds line delta for ${line.id}`)
      continue
    }

    for (const item of lineEvidence) {
      const key = effectKey(item.effect)
      const nextEffectTotal = effectTotals[key] + item.deltaCents
      if (!Number.isSafeInteger(nextEffectTotal)) {
        reasons.push(`attribution ${item.effect} total exceeds safe integer cents`)
        continue
      }
      effectTotals[key] = nextEffectTotal
    }

    const unknownRemainder = line.deltaCents - attributedForLine
    const nextUnknownTotal = effectTotals.unknownCents! + unknownRemainder
    if (
      !Number.isSafeInteger(unknownRemainder) ||
      !Number.isSafeInteger(nextUnknownTotal)
    ) {
      reasons.push(`attribution unknown total exceeds safe integer cents for ${line.id}`)
      continue
    }
    effectTotals.unknownCents = nextUnknownTotal
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

  if (!Number.isSafeInteger(knownTotal) || !Number.isSafeInteger(accountedTotal)) {
    return {
      status: 'unknown',
      fullyAttributed: false,
      comparisonDeltaCents: comparison.deltaCents,
      effectTotals: emptyTotals(),
      reasons: ['attribution aggregate exceeds safe integer cents'],
    }
  }

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
