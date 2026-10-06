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
const EXPLICIT_OFFSET_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/

function validEvidenceTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !EXPLICIT_OFFSET_TIMESTAMP.test(value)) {
    return false
  }

  const offset = value.match(/([+-])(\d{2}):(\d{2})$/)
  if (
    offset &&
    (Number(offset[2]) > 23 || Number(offset[3]) > 59)
  ) {
    return false
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
  fixture: ReviewedLiveProductFixture,
  expectedSupermarket: SupermarketId,
): RawProductObservation {
  if (fixture.version !== 1) {
    throw new Error('Reviewed live fixture must use version 1')
  }
  if (fixture.fixtureType !== 'reviewed-live-product-observation') {
    throw new Error('Unexpected reviewed live fixture type')
  }
  if (!isSafeSourceId(fixture.source?.id)) {
    throw new Error('Reviewed live fixture must use a path-safe source id')
  }
  if (!validEvidenceTimestamp(fixture.source?.capturedAt)) {
    throw new Error(
      'Reviewed live fixture source must include a timestamp with an explicit timezone offset',
    )
  }
  if (fixture.source.kind !== 'product') {
    throw new Error('Reviewed live product fixture must come from a product source')
  }
  if (fixture.source.supermarket !== expectedSupermarket) {
    throw new Error(
      `Reviewed live fixture supermarket mismatch: expected=${expectedSupermarket} actual=${fixture.source.supermarket}`,
    )
  }

  const observation = validateRawProductObservation(fixture.observation)
  if (observation.supermarket !== expectedSupermarket) {
    throw new Error(
      `Reviewed live observation supermarket mismatch: expected=${expectedSupermarket} actual=${observation.supermarket}`,
    )
  }
  if (!sourceExactlyMatchesObservation(fixture.source, observation)) {
    throw new Error(
      `Reviewed live fixture provenance does not exactly match observation: ${fixture.source.id}`,
    )
  }

  if (typeof fixture.review?.reviewer !== 'string' || !fixture.review.reviewer.trim()) {
    throw new Error('Reviewed live fixture must identify a reviewer')
  }
  if (!validEvidenceTimestamp(fixture.review?.reviewedAt)) {
    throw new Error(
      'Reviewed live fixture must include a valid reviewedAt with an explicit timezone offset',
    )
  }

  validateReviewChronology(fixture)
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
