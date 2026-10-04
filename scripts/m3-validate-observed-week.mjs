import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const MILESTONE = 'M3 Full-basket comparison & savings proof'
const OBSERVATION_METHODS = new Set([
  'manual_price_observation',
  'receipt',
  'authorized_source_snapshot',
])
const DIRECTIONS = new Set(['better', 'same', 'worse', 'unknown'])
const EFFECT_KEYS = ['packSizeCents', 'offerCents', 'planningCents']

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isoDateTime(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}

function sha256Ref(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)
}

function integerOrNull(value, label) {
  assert(
    value === null || Number.isInteger(value),
    `${label} must be integer cents or null`,
  )
}

function validateBasketObservation(basket, role, planFingerprint, weekStartMs) {
  assert(basket?.role === role, `missing ${role} basket observation`)
  assert(nonEmptyString(basket.storeId), `${role} storeId is required`)
  assert(nonEmptyString(basket.storeName), `${role} storeName is required`)
  assert(
    OBSERVATION_METHODS.has(basket.observationMethod),
    `${role} observationMethod must be an observed-data method`,
  )
  assert(
    basket.planFingerprint === planFingerprint,
    `${role} basket must use the study plan fingerprint`,
  )
  assert(isoDateTime(basket.observedAt), `${role} observedAt must be an ISO UTC timestamp`)
  const observedAtMs = Date.parse(basket.observedAt)
  assert(
    observedAtMs >= weekStartMs && observedAtMs < weekStartMs + 7 * 24 * 60 * 60 * 1000,
    `${role} observation must fall inside the declared week`,
  )
  assert(nonEmptyString(basket.sourceRef), `${role} sourceRef is required`)
  assert(
    Number.isInteger(basket.totalCents) && basket.totalCents >= 0,
    `${role} totalCents must be non-negative integer cents`,
  )
  assert(
    Number.isInteger(basket.matchedLineCount) && basket.matchedLineCount >= 0,
    `${role} matchedLineCount must be a non-negative integer`,
  )
  assert(
    Array.isArray(basket.unresolvedIngredientIds),
    `${role} unresolvedIngredientIds must be an array`,
  )
  const unresolved = basket.unresolvedIngredientIds
  assert(
    unresolved.every(nonEmptyString),
    `${role} unresolved ingredient ids must be non-empty strings`,
  )
  assert(
    new Set(unresolved).size === unresolved.length,
    `${role} unresolved ingredient ids must be unique`,
  )
  assert(typeof basket.complete === 'boolean', `${role} complete must be boolean`)
  assert(
    basket.complete === (unresolved.length === 0),
    `${role} complete must agree with unresolved ingredients`,
  )

  return {
    role,
    storeId: basket.storeId,
    storeName: basket.storeName,
    observationMethod: basket.observationMethod,
    observedAt: basket.observedAt,
    complete: basket.complete,
    totalCents: basket.totalCents,
    unresolvedIngredientIds: [...unresolved],
  }
}

export function evaluateObservedWeekEvidence(document) {
  assert(document && typeof document === 'object', 'observed-week evidence must be an object')
  assert(document.version === 1, 'observed-week evidence must use version 1')
  assert(document.milestone === MILESTONE, `milestone must be ${MILESTONE}`)
  assert(document.evidenceType === 'observed_week', 'evidenceType must be observed_week')
  assert(nonEmptyString(document.studyId), 'studyId is required')
  assert(isoDate(document.weekStart), 'weekStart must be an ISO date')
  assert(nonEmptyString(document.region), 'region is required')

  const weekStart = new Date(`${document.weekStart}T00:00:00Z`)
  assert(
    !Number.isNaN(weekStart.valueOf()) && weekStart.getUTCDay() === 1,
    'weekStart must be a valid Monday',
  )
  const weekStartMs = weekStart.valueOf()

  const plan = document.plan
  assert(plan && typeof plan === 'object', 'plan is required')
  assert(sha256Ref(plan.fingerprint), 'plan fingerprint must be sha256:<64 hex>')
  assert(
    Number.isInteger(plan.selectedMealCount) && plan.selectedMealCount > 0,
    'plan selectedMealCount must be a positive integer',
  )
  assert(
    Array.isArray(plan.recipeIds) &&
      plan.recipeIds.length === plan.selectedMealCount &&
      plan.recipeIds.every(nonEmptyString),
    'plan recipeIds must contain one recipe id per selected meal',
  )

  assert(
    Array.isArray(document.baskets) && document.baskets.length === 2,
    'observed-week evidence must contain exactly baseline and candidate baskets',
  )
  const baselineRaw = document.baskets.find((basket) => basket?.role === 'baseline')
  const candidateRaw = document.baskets.find((basket) => basket?.role === 'candidate')
  const baseline = validateBasketObservation(
    baselineRaw,
    'baseline',
    plan.fingerprint,
    weekStartMs,
  )
  const candidate = validateBasketObservation(
    candidateRaw,
    'candidate',
    plan.fingerprint,
    weekStartMs,
  )
  assert(
    baseline.storeId !== candidate.storeId,
    'baseline and candidate stores must differ',
  )

  const comparison = document.comparison
  assert(comparison && typeof comparison === 'object', 'comparison is required')
  assert(typeof comparison.claimable === 'boolean', 'comparison claimable must be boolean')
  assert(DIRECTIONS.has(comparison.direction), 'comparison direction is invalid')
  assert(Array.isArray(comparison.reasons), 'comparison reasons must be an array')
  assert(
    comparison.reasons.every(nonEmptyString),
    'comparison reasons must be non-empty strings',
  )

  for (const key of EFFECT_KEYS) {
    integerOrNull(comparison.effects?.[key] ?? null, `comparison.effects.${key}`)
  }
  integerOrNull(
    comparison.effects?.unexplainedCents ?? null,
    'comparison.effects.unexplainedCents',
  )

  if (comparison.claimable) {
    assert(baseline.complete && candidate.complete, 'claimable comparison requires complete baskets')
    assert(comparison.reasons.length === 0, 'claimable comparison cannot have blocking reasons')
    assert(Number.isInteger(comparison.deltaCents), 'claimable comparison requires integer deltaCents')
    const expectedDelta = baseline.totalCents - candidate.totalCents
    assert(
      comparison.deltaCents === expectedDelta,
      'comparison deltaCents must equal baseline total minus candidate total',
    )
    const expectedDirection =
      expectedDelta > 0 ? 'better' : expectedDelta < 0 ? 'worse' : 'same'
    assert(
      comparison.direction === expectedDirection,
      'comparison direction does not match deltaCents',
    )

    const knownEffects = EFFECT_KEYS.reduce(
      (sum, key) => sum + (comparison.effects?.[key] ?? 0),
      0,
    )
    const unexplained = comparison.effects?.unexplainedCents ?? null
    if (unexplained !== null) {
      assert(
        knownEffects + unexplained === expectedDelta,
        'effect attribution must reconcile to deltaCents when unexplainedCents is provided',
      )
    }
  } else {
    assert(comparison.direction === 'unknown', 'unclaimable comparison direction must be unknown')
    assert(comparison.deltaCents === null, 'unclaimable comparison deltaCents must be null')
    assert(comparison.reasons.length > 0, 'unclaimable comparison requires a reason')
    assert(
      comparison.effects?.unexplainedCents == null,
      'unclaimable comparison cannot expose unexplained financial attribution',
    )
  }

  assert(
    document.publicSavingsClaimEligible === false,
    'a single observed-week record can never be marked publicSavingsClaimEligible',
  )

  return {
    milestone: document.milestone,
    studyId: document.studyId,
    weekStart: document.weekStart,
    region: document.region,
    planFingerprint: plan.fingerprint,
    stores: [baseline, candidate],
    claimable: comparison.claimable,
    direction: comparison.direction,
    deltaCents: comparison.deltaCents,
    publicSavingsClaimEligible: false,
  }
}

export async function main() {
  const file = process.env.SUPA_M3_OBSERVED_WEEK || process.argv[2]
  assert(file, 'provide an observed-week evidence JSON path')
  const document = JSON.parse(await readFile(file, 'utf8'))
  console.log(JSON.stringify(evaluateObservedWeekEvidence(document), null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
