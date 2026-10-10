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

export type ObservedBasketPriceContext = 'in-store' | 'online-order'

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
  priceContext: ObservedBasketPriceContext
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
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/

function isPathSafeKey(value: unknown) {
  return typeof value === 'string' && KEY_PATTERN.test(value)
}

function hasNonEmptyText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
}

function validCalendarDate(value: unknown) {
  if (typeof value !== 'string') return false

  const match = DATE_PATTERN.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function validTimestamp(value: unknown) {
  if (typeof value !== 'string') return null

  const match = TIMESTAMP_PATTERN.exec(value)
  if (!match || !validCalendarDate(match[1])) return null

  const hour = Number(match[2])
  const minute = Number(match[3])
  const second = Number(match[4] ?? '0')
  if (hour > 23 || minute > 59 || second > 59) return null

  if (match[5] !== 'Z') {
    const [offsetHour, offsetMinute] = match[5]
      .slice(1)
      .split(':')
      .map(Number)
    if (offsetHour > 14 || offsetMinute > 59 ||
        (offsetHour === 14 && offsetMinute !== 0)) return null
  }

  const timestamp = Date.parse(value)
  // The assessment itself is a financial-claim boundary. Do not rely on
  // optional collection or CSV preflights having already checked the clock.
  return Number.isFinite(timestamp) && timestamp <= Date.now() ? timestamp : null
}

function validateEvidence(
  label: 'baseline' | 'candidate',
  evidence: ObservedBasketEvidence,
) {
  const reasons: string[] = []

  if (!isPathSafeKey(evidence.evidenceId)) {
    reasons.push(`${label} evidenceId is not a path-safe evidence key`)
  }

  if (!['manual-cart', 'receipt', 'consented-export'].includes(evidence.source)) {
    reasons.push(`${label} evidence source is not an allowed observed source`)
  }

  if (!hasNonEmptyText(evidence.provenanceNote)) {
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
  options: unknown = {},
): WeeklyBasketStudyAssessment {
  const validOptionsContainer =
    options !== null &&
    typeof options === 'object' &&
    !Array.isArray(options)
  const requestedMaxObservationWindowHours = validOptionsContainer
    ? ((options as { maxObservationWindowHours?: unknown })
        .maxObservationWindowHours ?? 24)
    : 24
  const validMaxObservationWindowHours =
    typeof requestedMaxObservationWindowHours === 'number' &&
    Number.isFinite(requestedMaxObservationWindowHours) &&
    requestedMaxObservationWindowHours > 0
  const maxObservationWindowHours = validMaxObservationWindowHours
    ? requestedMaxObservationWindowHours
    : 24
  const reasons: string[] = []

  if (!validOptionsContainer) {
    reasons.push('assessment options must be a non-array object')
  } else if (!validMaxObservationWindowHours) {
    reasons.push('maxObservationWindowHours must be a positive finite number')
  }

  if (study.schemaVersion !== 1) {
    reasons.push('unsupported study schema version')
  }
  if (!isPathSafeKey(study.studyId)) {
    reasons.push('studyId is not a path-safe study key')
  }
  if (!isPathSafeKey(study.participantKey)) {
    reasons.push('participantKey must be a pseudonymous path-safe key')
  }
  if (!hasNonEmptyText(study.population)) {
    reasons.push('population is required')
  }
  if (!hasNonEmptyText(study.region)) {
    reasons.push('region is required')
  }
  if (!validCalendarDate(study.weekStart)) {
    reasons.push('weekStart must be a valid YYYY-MM-DD date')
  }
  if (!['in-store', 'online-order'].includes(study.priceContext)) {
    reasons.push('priceContext must be in-store or online-order')
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
