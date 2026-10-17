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
  // Required context must contain a visible Unicode base character; invisible
  // formats/marks/fillers alone cannot authorize an observed savings outcome.
  return typeof value === 'string' && /[^\p{M}\p{Cf}\p{Cc}\p{Cs}\s\u115F\u1160\u3164\uFFA0\u2800]/u.test(value)
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
    // A civil UTC offset cannot exceed +/-14:00 (14:30 is also impossible).
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0) ||
        (match[5].startsWith('-') && (offsetHour > 12 ||
          (offsetHour === 12 && offsetMinute !== 0)))) return null
  }

  // Date.parse rounds away any fractional digits after milliseconds. A
  // purported 24h+1ns capture cannot become an exactly-24h money claim.
  // Extra zero digits remain accepted because they add no elapsed time.
  const fractionalSeconds = /\.(\d{1,9})(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1]
  if (fractionalSeconds && /[1-9]/.test(fractionalSeconds.slice(3))) return null

  const timestamp = Date.parse(value)
  // Deterministic domain parser: the evaluation clock is an explicit caller input.
  return Number.isFinite(timestamp) ? timestamp : null
}

// The planned week is a civil-date interval, not a rolling UTC hours window.
// Allow advance shopping on the two preceding days as well as the seven days
// of the plan. Read each observedAt's own explicitly validated local date.
const PRE_WEEK_SHOPPING_DAYS = 2
const PLANNED_WEEK_DAYS = 7
const MS_PER_DAY = 24 * 60 * 60 * 1000

function localCalendarDayIndex(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY)
}

function matchesDeclaredPlanningWeek(weekStart: string, observedAt: string) {
  const daysFromWeekStart =
    localCalendarDayIndex(observedAt.slice(0, 10)) -
    localCalendarDayIndex(weekStart)
  return (
    daysFromWeekStart >= -PRE_WEEK_SHOPPING_DAYS &&
    daysFromWeekStart < PLANNED_WEEK_DAYS
  )
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

function assessWeeklyBasketStudyCore(
  study: WeeklyBasketStudy,
  options: unknown = {},
): WeeklyBasketStudyAssessment {
  const validOptionsContainer =
    options !== null &&
    typeof options === 'object' &&
    !Array.isArray(options)
  const configuredWindow = validOptionsContainer
    ? (options as { maxObservationWindowHours?: unknown })
        .maxObservationWindowHours
    : undefined
  // Missing means canonical default; explicit null must not enable evidence.
  const requestedMaxObservationWindowHours =
    configuredWindow === undefined ? 24 : configuredWindow
  const validMaxObservationWindowHours =
    typeof requestedMaxObservationWindowHours === 'number' &&
    Number.isFinite(requestedMaxObservationWindowHours) &&
    requestedMaxObservationWindowHours > 0 &&
    requestedMaxObservationWindowHours <= 24
  const maxObservationWindowHours = validMaxObservationWindowHours
    ? requestedMaxObservationWindowHours
    : 24
  const reasons: string[] = []

  if (!validOptionsContainer) {
    reasons.push('assessment options must be a non-array object')
  } else if (!validMaxObservationWindowHours) {
    reasons.push('maxObservationWindowHours must be a positive finite number no greater than 24')
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

  // Zero-demand baskets can be equal mathematically, but do not establish
  // a real supermarket saving, regardless of their reported totals.
  if (
    study.baseline.basket.selectedMealCount === 0 ||
    study.candidate.basket.selectedMealCount === 0
  ) {
    reasons.push('observed baskets require at least one selected meal')
  }
  if (
    !Array.isArray(study.baseline.basket.lines) ||
    !Array.isArray(study.candidate.basket.lines) ||
    study.baseline.basket.lines.length === 0 ||
    study.candidate.basket.lines.length === 0
  ) {
    reasons.push('observed baskets require at least one ingredient line')
  }

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
  const referenceNowMs = validOptionsContainer
    ? (options as { referenceNowMs?: unknown }).referenceNowMs
    : undefined
  if (referenceNowMs !== undefined &&
    (typeof referenceNowMs !== 'number' || !Number.isFinite(referenceNowMs))) {
    reasons.push('assessment reference clock is malformed')
  } else if (typeof referenceNowMs === 'number') {
    if (baselineObservedAt !== null && baselineObservedAt > referenceNowMs) {
      reasons.push('baseline observedAt is later than assessment reference time')
    }
    if (candidateObservedAt !== null && candidateObservedAt > referenceNowMs) {
      reasons.push('candidate observedAt is later than assessment reference time')
    }
  }
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

  // Only validated calendar dates/timestamps participate in week cohesion;
  // each price observation must belong to this week or its two shopping days
  // before the plan, independently of the separate <=24h store-pair gate.
  if (validCalendarDate(study.weekStart)) {
    if (
      baselineObservedAt !== null &&
      !matchesDeclaredPlanningWeek(study.weekStart, study.baseline.observedAt)
    ) {
      reasons.push('baseline observation is outside the declared planning week shopping window')
    }
    if (
      candidateObservedAt !== null &&
      !matchesDeclaredPlanningWeek(study.weekStart, study.candidate.observedAt)
    ) {
      reasons.push('candidate observation is outside the declared planning week shopping window')
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


/**
 * Imported observation JSON does not honor the WeeklyBasketStudy TypeScript
 * type. A malformed root, evidence or nested basket must not throw at the
 * financial claim boundary or publish invented basket totals.
 */
function runtimeRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function ownObservedFact(record: object, field: string): unknown {
  // Getter-backed or prototype-supplied evidence is not a persisted fact.
  const descriptor = Object.getOwnPropertyDescriptor(record, field)
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : undefined
}

function hasObservedStudyContainers(value: unknown): value is WeeklyBasketStudy {
  if (!runtimeRecord(value)) return false
  for (const side of ['baseline', 'candidate'] as const) {
    const evidence = ownObservedFact(value, side)
    if (!runtimeRecord(evidence)) return false
    const basket = ownObservedFact(evidence, 'basket')
    if (!runtimeRecord(basket) ||
        !runtimeRecord(ownObservedFact(basket, 'store')) ||
        !Array.isArray(ownObservedFact(basket, 'lines'))) return false
  }
  return true
}

function invalidObservedStudyAssessment(): WeeklyBasketStudyAssessment {
  const reasons = ['observed study contains malformed evidence or basket containers']
  // Invalid money is not a price. NaN satisfies the static number
  // boundary while serialized private JSON represents the absence as null.
  // Unknown comparisons never display or add this sentinel.
  const missingTotal = Number.NaN
  const comparison: BasketComparison = {
    outcome: 'unknown',
    claimable: false,
    baselineTotalCents: missingTotal,
    candidateTotalCents: missingTotal,
    deltaCents: null,
    savingsCents: null,
    lineDeltas: [],
    reasons,
  }
  return {
    claimable: false,
    reasons,
    comparison,
    attribution: attributeSavingsEffects({ comparison, evidence: [] }),
    observationWindowHours: null,
  }
}

export function assessWeeklyBasketStudy(
  study: WeeklyBasketStudy,
  options: unknown = {},
): WeeklyBasketStudyAssessment {
  try {
    if (!hasObservedStudyContainers(study)) return invalidObservedStudyAssessment()
    return assessWeeklyBasketStudyCore(study, options)
  } catch {
    // Read-only assessment must never promote malformed runtime records to
    // a savings claim or allow a thrown nested accessor to crash the caller.
    return invalidObservedStudyAssessment()
  }
}
