import type {
  RawProductObservation,
  SourceSnapshotRef,
  SupermarketId,
} from './ingestion.ts'
import { validateRawProductObservation } from './ingestion.ts'

export type ReviewedLiveProductFixture = {
  version: 1
  fixtureType: 'reviewed-live-product-observation'
  source: SourceSnapshotRef & { id: string }
  observation: RawProductObservation
  review: {
    reviewer: string
    reviewedAt: string
    notes: string | null
  }
}

const MAX_REVIEW_CLOCK_SKEW_MS = 5 * 60 * 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validIso(value: unknown): value is string {
  if (typeof value !== 'string') return false

  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    )
  if (!match) return false

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] =
    match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ]

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false
  }

  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3))
    const offsetMinute = Number(zone.slice(4, 6))
    if (offsetHour > 23 || offsetMinute > 59) return false
  }

  return Number.isFinite(Date.parse(value))
}

function isSafeSourceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  )
}

function sourceExactlyMatchesObservation(
  source: ReviewedLiveProductFixture['source'],
  observation: RawProductObservation,
) {
  const provenance = observation.provenance
  return (
    provenance.supermarket === source.supermarket &&
    provenance.kind === source.kind &&
    provenance.url === source.url &&
    provenance.capturedAt === source.capturedAt &&
    provenance.sha256 === source.sha256
  )
}

function validateReviewChronology(
  fixture: ReviewedLiveProductFixture,
  now = Date.now(),
) {
  const capturedAt = Date.parse(fixture.source.capturedAt)
  const reviewedAt = Date.parse(fixture.review.reviewedAt)

  if (reviewedAt < capturedAt) {
    throw new Error('Reviewed live fixture review cannot predate its capture')
  }

  if (reviewedAt > now + MAX_REVIEW_CLOCK_SKEW_MS) {
    throw new Error(
      'Reviewed live fixture review timestamp is implausibly in the future',
    )
  }
}

export function validateReviewedLiveProductFixture(
  fixture: unknown,
  expectedSupermarket: SupermarketId,
): RawProductObservation {
  if (!isRecord(fixture)) {
    throw new Error('Reviewed live fixture must be an object')
  }
  if (!isRecord(fixture.source)) {
    throw new Error('Reviewed live fixture must include a source object')
  }
  if (!isRecord(fixture.review)) {
    throw new Error('Reviewed live fixture must include a review object')
  }

  const reviewedFixture = fixture as ReviewedLiveProductFixture

  if (reviewedFixture.version !== 1) {
    throw new Error('Reviewed live fixture must use version 1')
  }
  if (reviewedFixture.fixtureType !== 'reviewed-live-product-observation') {
    throw new Error('Unexpected reviewed live fixture type')
  }
  if (!isSafeSourceId(reviewedFixture.source.id)) {
    throw new Error('Reviewed live fixture must use a path-safe source id')
  }
  if (reviewedFixture.source.kind !== 'product') {
    throw new Error('Reviewed live product fixture must come from a product source')
  }
  if (reviewedFixture.source.supermarket !== expectedSupermarket) {
    throw new Error(
      `Reviewed live fixture supermarket mismatch: expected=${expectedSupermarket} actual=${reviewedFixture.source.supermarket}`,
    )
  }

  const observation = validateRawProductObservation(reviewedFixture.observation)
  if (observation.supermarket !== expectedSupermarket) {
    throw new Error(
      `Reviewed live observation supermarket mismatch: expected=${expectedSupermarket} actual=${observation.supermarket}`,
    )
  }
  if (!sourceExactlyMatchesObservation(reviewedFixture.source, observation)) {
    throw new Error(
      `Reviewed live fixture provenance does not exactly match observation: ${reviewedFixture.source.id}`,
    )
  }

  if (
    typeof reviewedFixture.review.reviewer !== 'string' ||
    !reviewedFixture.review.reviewer.trim()
  ) {
    throw new Error('Reviewed live fixture must identify a reviewer')
  }
  if (!validIso(reviewedFixture.review.reviewedAt)) {
    throw new Error('Reviewed live fixture must include a valid reviewedAt')
  }
  if (
    reviewedFixture.review.notes !== null &&
    typeof reviewedFixture.review.notes !== 'string'
  ) {
    throw new Error('Reviewed live fixture review notes must be null or a string')
  }

  validateReviewChronology(reviewedFixture)
  return observation
}

export type ReviewedFixtureAdapter = {
  supermarket: SupermarketId
  fromReviewedFixture(
    fixture: ReviewedLiveProductFixture,
  ): RawProductObservation
}

export function createReviewedFixtureAdapter(
  supermarket: SupermarketId,
): ReviewedFixtureAdapter {
  return {
    supermarket,
    fromReviewedFixture(fixture) {
      return validateReviewedLiveProductFixture(fixture, supermarket)
    },
  }
}

export const ahReviewedFixtureAdapter = createReviewedFixtureAdapter('ah')
export const plusReviewedFixtureAdapter = createReviewedFixtureAdapter('plus')
