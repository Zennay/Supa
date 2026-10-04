import type { OneStoreBasket } from './basket.ts'
import {
  compareFullBaskets,
  type BasketComparison,
} from './basketComparison.ts'
import {
  attributeSavingsEffects,
  type SavingsAttribution,
  type SavingsAttributionEvidence,
} from './savingsAttribution.ts'

export type ObservedBasketSource =
  | 'manual-cart'
  | 'receipt'
  | 'consented-export'

export type ObservedBasketEvidence = {
  evidenceId: string
  observedAt: string
  source: ObservedBasketSource
  provenanceNote: string
  basket: OneStoreBasket
}

export type WeeklyBasketStudy = {
  schemaVersion: 1
  studyId: string
  participantKey: string
  population: string
  region: string
  weekStart: string
  baseline: ObservedBasketEvidence
  candidate: ObservedBasketEvidence
  attributionEvidence?: SavingsAttributionEvidence[]
}

export type WeeklyBasketStudyAssessment = {
  claimable: boolean
  reasons: string[]
  comparison: BasketComparison
  attribution: SavingsAttribution
  observationWindowHours: number | null
}

const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function validTimestamp(value: string) {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function validateEvidence(
  label: 'baseline' | 'candidate',
  evidence: ObservedBasketEvidence,
) {
  const reasons: string[] = []

  if (!KEY_PATTERN.test(evidence.evidenceId)) {
    reasons.push(`${label} evidenceId is not a path-safe evidence key`)
  }

  if (!['manual-cart', 'receipt', 'consented-export'].includes(evidence.source)) {
    reasons.push(`${label} evidence source is not an allowed observed source`)
  }

  if (!evidence.provenanceNote.trim()) {
    reasons.push(`${label} evidence provenance note is required`)
  }

  if (validTimestamp(evidence.observedAt) === null) {
    reasons.push(`${label} observedAt is not a valid timestamp`)
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
    reasons,
  }
}

export function assessWeeklyBasketStudy(
  study: WeeklyBasketStudy,
  options: { maxObservationWindowHours?: number } = {},
): WeeklyBasketStudyAssessment {
  const maxObservationWindowHours = options.maxObservationWindowHours ?? 24
  const reasons: string[] = []

  if (study.schemaVersion !== 1) {
    reasons.push('unsupported study schema version')
  }
  if (!KEY_PATTERN.test(study.studyId)) {
    reasons.push('studyId is not a path-safe study key')
  }
  if (!KEY_PATTERN.test(study.participantKey)) {
    reasons.push('participantKey must be a pseudonymous path-safe key')
  }
  if (!study.population.trim()) {
    reasons.push('population is required')
  }
  if (!study.region.trim()) {
    reasons.push('region is required')
  }
  if (!DATE_PATTERN.test(study.weekStart) || Number.isNaN(Date.parse(study.weekStart))) {
    reasons.push('weekStart must be a valid YYYY-MM-DD date')
  }

  reasons.push(...validateEvidence('baseline', study.baseline))
  reasons.push(...validateEvidence('candidate', study.candidate))

  if (
    study.attributionEvidence !== undefined &&
    !Array.isArray(study.attributionEvidence)
  ) {
    reasons.push('attributionEvidence must be an array when provided')
  }

  if (study.baseline.evidenceId === study.candidate.evidenceId) {
    reasons.push('baseline and candidate evidence IDs must differ')
  }
  if (study.baseline.basket.store.id === study.candidate.basket.store.id) {
    reasons.push('baseline and candidate stores must differ')
  }

  const baselineObservedAt = validTimestamp(study.baseline.observedAt)
  const candidateObservedAt = validTimestamp(study.candidate.observedAt)
  let observationWindowHours: number | null = null

  if (baselineObservedAt !== null && candidateObservedAt !== null) {
    observationWindowHours =
      Math.abs(candidateObservedAt - baselineObservedAt) / (1000 * 60 * 60)
    if (observationWindowHours > maxObservationWindowHours) {
      reasons.push(
        `basket observations are ${observationWindowHours.toFixed(2)}h apart; max is ${maxObservationWindowHours}h`,
      )
    }
  }

  const comparison = compareFullBaskets({
    baseline: study.baseline.basket,
    candidate: study.candidate.basket,
  })

  if (!comparison.claimable) {
    reasons.push(...comparison.reasons)
  }

  const uniqueReasons = [...new Set(reasons)]
  if (uniqueReasons.length > 0) {
    const invalidComparison = unknownComparison(
      study.baseline.basket,
      study.candidate.basket,
      uniqueReasons,
    )
    return {
      claimable: false,
      reasons: uniqueReasons,
      comparison: invalidComparison,
      attribution: attributeSavingsEffects({
        comparison: invalidComparison,
        evidence: Array.isArray(study.attributionEvidence)
          ? study.attributionEvidence
          : [],
      }),
      observationWindowHours,
    }
  }

  return {
    claimable: true,
    reasons: [],
    comparison,
    attribution: attributeSavingsEffects({
      comparison,
      evidence: study.attributionEvidence ?? [],
    }),
    observationWindowHours,
  }
}
