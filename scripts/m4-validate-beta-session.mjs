import { readFile, open, link, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const SESSION_OUTCOMES = new Set(['completed', 'abandoned', 'unknown'])
const MEAL_OUTCOMES = new Set(['followed', 'skipped', 'swapped', 'unknown'])
const LEFTOVER_OUTCOMES = new Set(['reused', 'wasted', 'remaining', 'unknown'])
const BASKET_OUTCOMES = new Set(['better', 'same', 'worse', 'unknown'])
const SAFE_SESSION_KEY = /^[a-z0-9][a-z0-9_-]{2,63}$/
const DIRECT_EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/iu

const EVENT_TYPES = new Set([
  'beta_session_started',
  'baseline_planning_completed',
  'plan_started',
  'meal_decision_recorded',
  'plan_completed',
  'list_edit_recorded',
  'reuse_explanation_viewed',
  'schedule_change_recorded',
  'repair_started',
  'repair_completed',
  'meal_outcome_recorded',
  'leftover_event_recorded',
  'basket_assessment_viewed',
  'basket_recommendation_decided',
  'trust_rating_submitted',
  'weekly_effort_submitted',
  'beta_week_closed',
])

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireRecord(value, path) {
  assert(isRecord(value), `${path} must be an object`)
  return value
}

function requireString(value, path) {
  assert(typeof value === 'string' && value.trim().length > 0, `${path} must be a non-empty string`)
}

function requirePrivateSummaryMetadata(value, path) {
  requireString(value, path)
  assert(!DIRECT_EMAIL_PATTERN.test(value), `${path} must not contain a direct email identifier`)
}

function requireBoolean(value, path) {
  assert(typeof value === 'boolean', `${path} must be a boolean`)
}

function requireNonNegativeInteger(value, path) {
  assert(Number.isSafeInteger(value) && value >= 0, `${path} must be a non-negative safe integer`)
}

function requirePositiveInteger(value, path) {
  assert(Number.isSafeInteger(value) && value > 0, `${path} must be a positive safe integer`)
}

function requireRating(value, path) {
  assert(Number.isInteger(value) && value >= 1 && value <= 5, `${path} must be an integer from 1 to 5`)
}

function parseTimestamp(value, path) {
  requireString(value, path)
  const parsed = Date.parse(value)
  assert(Number.isFinite(parsed), `${path} must be a valid timestamp`)
  return parsed
}

function requireEnum(value, allowed, path) {
  assert(allowed.has(value), `${path} is not an allowed value`)
}

function validateEventPayload(event, path) {
  switch (event.type) {
    case 'beta_session_started':
      requireString(event.participant_id, `${path}.participant_id`)
      requireString(event.study_week_id, `${path}.study_week_id`)
      break
    case 'baseline_planning_completed':
      requireNonNegativeInteger(event.duration_seconds, `${path}.duration_seconds`)
      requireNonNegativeInteger(event.explicit_meal_decisions, `${path}.explicit_meal_decisions`)
      requireNonNegativeInteger(event.manual_edits, `${path}.manual_edits`)
      requireRating(event.effort_rating, `${path}.effort_rating`)
      break
    case 'plan_started':
      requireNonNegativeInteger(event.budget_cents, `${path}.budget_cents`)
      requirePositiveInteger(event.planned_days_count, `${path}.planned_days_count`)
      break
    case 'meal_decision_recorded':
      requireString(event.meal_slot, `${path}.meal_slot`)
      requireString(event.decision_kind, `${path}.decision_kind`)
      break
    case 'plan_completed':
      requireNonNegativeInteger(event.duration_seconds, `${path}.duration_seconds`)
      requirePositiveInteger(event.planned_meals_count, `${path}.planned_meals_count`)
      requireNonNegativeInteger(event.explicit_meal_decisions, `${path}.explicit_meal_decisions`)
      break
    case 'list_edit_recorded':
      requireString(event.edit_kind, `${path}.edit_kind`)
      requireString(event.item_key, `${path}.item_key`)
      break
    case 'reuse_explanation_viewed':
      requireString(event.ingredient_key, `${path}.ingredient_key`)
      requirePositiveInteger(event.related_meal_count, `${path}.related_meal_count`)
      break
    case 'schedule_change_recorded':
      requireString(event.change_kind, `${path}.change_kind`)
      requireString(event.affected_slot, `${path}.affected_slot`)
      break
    case 'repair_started':
      requireString(event.repair_kind, `${path}.repair_kind`)
      break
    case 'repair_completed':
      requireString(event.repair_kind, `${path}.repair_kind`)
      requireNonNegativeInteger(event.duration_seconds, `${path}.duration_seconds`)
      requireNonNegativeInteger(event.manual_edits, `${path}.manual_edits`)
      break
    case 'meal_outcome_recorded':
      requireString(event.meal_slot, `${path}.meal_slot`)
      requireEnum(event.outcome, MEAL_OUTCOMES, `${path}.outcome`)
      break
    case 'leftover_event_recorded':
      requireString(event.ingredient_key, `${path}.ingredient_key`)
      requireEnum(event.outcome, LEFTOVER_OUTCOMES, `${path}.outcome`)
      break
    case 'basket_assessment_viewed':
      requireEnum(event.outcome, BASKET_OUTCOMES, `${path}.outcome`)
      requireNonNegativeInteger(event.unresolved_line_count, `${path}.unresolved_line_count`)
      assert(
        event.unresolved_line_count === 0 || event.outcome === 'unknown',
        `${path}.outcome must be unknown when basket lines are unresolved`,
      )
      break
    case 'basket_recommendation_decided':
      requireBoolean(event.followed, `${path}.followed`)
      requireString(event.reason, `${path}.reason`)
      break
    case 'trust_rating_submitted':
      requireRating(event.rating_1_to_5, `${path}.rating_1_to_5`)
      requireBoolean(event.uncertainty_understood, `${path}.uncertainty_understood`)
      break
    case 'weekly_effort_submitted':
      requireRating(event.rating_1_to_5, `${path}.rating_1_to_5`)
      break
    case 'beta_week_closed':
      requireRating(event.return_intent_1_to_5, `${path}.return_intent_1_to_5`)
      requireBoolean(event.interview_complete, `${path}.interview_complete`)
      break
    default:
      throw new Error(`${path}.type is not supported`)
  }
}

function validateEvent(event, index, startedAt, endedAt) {
  const path = `events[${index}]`
  requireRecord(event, path)
  requireEnum(event.type, EVENT_TYPES, `${path}.type`)
  const at = parseTimestamp(event.timestamp, `${path}.timestamp`)
  assert(at >= startedAt && at <= endedAt, `${path}.timestamp must fall inside the session window`)
  validateEventPayload(event, path)
}

function eventsOfType(events, type) {
  return events.filter((event) => event.type === type)
}

const MAX_MEAL_SLOT_UTF8_BYTES = 256
const UNSAFE_MEAL_SLOT_CHAR = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/u
const VISIBLE_MEAL_SLOT_BASE = /[\p{L}\p{N}\p{P}\p{S}]/u

// Measure adherence per *meal*, never per number of outcome events. Two
// distinct input spellings that NFKC-normalize to the same meal identity
// cannot create extra "followed" evidence. Keep the original values intact.
function validateMealOutcomeSlots(events) {
  const seen = new Set()
  for (const event of events) {
    if (event.type !== 'meal_outcome_recorded') continue
    const slot = event.meal_slot
    assert(
      typeof slot === 'string' &&
      slot.trim().length > 0 &&
      slot === slot.trim() &&
      Buffer.byteLength(slot, 'utf8') <= MAX_MEAL_SLOT_UTF8_BYTES,
      'M4 meal outcome slot must be canonical bounded text',
    )
    assert(
      !UNSAFE_MEAL_SLOT_CHAR.test(slot),
      'M4 meal outcome slot contains unsafe characters',
    )
    const identity = slot.normalize('NFKC')
    assert(
      VISIBLE_MEAL_SLOT_BASE.test(identity),
      'M4 meal outcome slot must include a visible base character',
    )
    assert(
      !seen.has(identity),
      'M4 meal outcome slot must have exactly one final outcome',
    )
    seen.add(identity)
  }
}


function latestEvent(events, type) {
  return eventsOfType(events, type)
    .slice()
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .at(-1) ?? null
}

// A completed repair counts as evidence only if it consumes one earlier
// still-open start of the same kind. Sort a *copy* by timestamp; incoming
// event order is not required to match collection order.
function validateRepairPairs(events) {
  const byTime = events
    .filter((event) => event.type === 'repair_started' || event.type === 'repair_completed')
    .map((event, index) => ({ event, index, at: Date.parse(event.timestamp) }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
  const unmatchedStarts = new Map()

  for (const { event, at } of byTime) {
    const starts = unmatchedStarts.get(event.repair_kind) ?? []
    if (event.type === 'repair_started') {
      starts.push(at)
      unmatchedStarts.set(event.repair_kind, starts)
      continue
    }
    assert(
      starts.length > 0 && starts[0] < at,
      'repair_completed requires a preceding unmatched repair_started of the same kind',
    )
    starts.shift()
  }
}

function validateCompletedWeekCausality(events) {
  const starts = eventsOfType(events, 'plan_started')
  const completed = eventsOfType(events, 'plan_completed')
  const closed = eventsOfType(events, 'beta_week_closed')
  assert(starts.length > 0, 'completed sessions require a plan_started event')
  assert(completed.length > 0, 'completed sessions require a plan_completed event')
  assert(closed.length > 0, 'completed sessions require a beta_week_closed event')
  assert(closed.length === 1, 'completed sessions require exactly one beta_week_closed event')

  const firstStart = Math.min(...starts.map((event) => Date.parse(event.timestamp)))
  const firstCompletion = Math.min(...completed.map((event) => Date.parse(event.timestamp)))
  const latestCompletion = Math.max(...completed.map((event) => Date.parse(event.timestamp)))
  const closeAt = Date.parse(closed[0].timestamp)
  assert(
    firstStart <= firstCompletion && latestCompletion <= closeAt,
    'completed session events require plan_started <= plan_completed <= beta_week_closed',
  )
  assert(
    completed.every((event) => Date.parse(event.timestamp) >= firstStart),
    'plan_completed must not precede plan_started',
  )
  assert(
    events.every((event) => event.type === 'beta_week_closed' ||
      Date.parse(event.timestamp) < closeAt),
    'completed session must not contain activity at or after beta_week_closed',
  )
}

function median(values) {
  if (values.length === 0) return null
  const sorted = values.slice().sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

export function validateBetaSession(input) {
  requireRecord(input, 'session')
  assert(input.schemaVersion === 1, 'schemaVersion must equal 1')
  assert(input.sessionType === 'm4-private-beta-session', 'sessionType must equal m4-private-beta-session')
  requirePrivateSummaryMetadata(input.sessionId, 'sessionId')
  assert(SAFE_SESSION_KEY.test(input.sessionId), 'sessionId must be a pseudonymous path-safe key')
  requireString(input.participantKey, 'participantKey')
  requirePrivateSummaryMetadata(input.population, 'population')
  requireEnum(input.sessionOutcome, SESSION_OUTCOMES, 'sessionOutcome')

  requireRecord(input.consent, 'consent')
  assert(input.consent.researchConsent === true, 'consent.researchConsent must be true')
  requireBoolean(input.consent.allowsAnonymizedQuotes, 'consent.allowsAnonymizedQuotes')

  requireRecord(input.m3Gate, 'm3Gate')
  assert(input.m3Gate.status === 'closed', 'm3Gate.status must be closed before M4 beta data is accepted')
  requireString(input.m3Gate.evidenceRef, 'm3Gate.evidenceRef')

  const startedAt = parseTimestamp(input.startedAt, 'startedAt')
  const endedAt = parseTimestamp(input.endedAt, 'endedAt')
  assert(endedAt >= startedAt, 'endedAt must not be before startedAt')

  assert(Array.isArray(input.events), 'events must be an array')
  input.events.forEach((event, index) => validateEvent(event, index, startedAt, endedAt))
  validateMealOutcomeSlots(input.events)
  const startEvents = eventsOfType(input.events, 'beta_session_started')
  assert(startEvents.length === 1, 'sessions require exactly one beta_session_started event')
  assert(
    startEvents[0].participant_id === input.participantKey,
    'beta_session_started.participant_id must match participantKey',
  )
  // The outer session window is a broad recording boundary, not proof
  // that research activity began. Evidence before its actual start event
  // would otherwise contaminate effort, meal and trust measurements.
  const actualSessionStart = Date.parse(startEvents[0].timestamp)
  assert(
    input.events.every(
      (event) => event === startEvents[0] ||
        Date.parse(event.timestamp) >= actualSessionStart,
    ),
    'M4 events must not precede beta_session_started',
  )

  // Protect effort metrics for all outcomes (including abandoned/unknown):
  // unmatched starts may remain partial evidence, orphan completions never count.
  validateRepairPairs(input.events)

  if (input.sessionOutcome === 'completed') {
    validateCompletedWeekCausality(input.events)
  }

  return input
}

export function buildBetaSessionSummary(input) {
  const session = validateBetaSession(input)
  const baseline = latestEvent(session.events, 'baseline_planning_completed')
  const plan = latestEvent(session.events, 'plan_completed')
  const basket = latestEvent(session.events, 'basket_assessment_viewed')
  const recommendationDecision = latestEvent(session.events, 'basket_recommendation_decided')
  const trust = latestEvent(session.events, 'trust_rating_submitted')
  const weeklyEffort = latestEvent(session.events, 'weekly_effort_submitted')
  const close = latestEvent(session.events, 'beta_week_closed')
  const mealOutcomes = eventsOfType(session.events, 'meal_outcome_recorded')
  const knownMealOutcomes = mealOutcomes.filter((event) => event.outcome !== 'unknown')
  const followedMeals = knownMealOutcomes.filter((event) => event.outcome === 'followed').length
  const leftoverEvents = eventsOfType(session.events, 'leftover_event_recorded')
  const repairCompletions = eventsOfType(session.events, 'repair_completed')
  const repairManualEdits = repairCompletions.reduce((sum, event) => {
    const next = sum + event.manual_edits
    assert(Number.isSafeInteger(next), 'repairManualEdits total exceeds safe integer range')
    return next
  }, 0)

  return {
    schemaVersion: 1,
    reportType: 'm4-private-beta-session-summary',
    sessionId: session.sessionId,
    population: session.population,
    sessionOutcome: session.sessionOutcome,
    baselinePlanningDurationSeconds: baseline?.duration_seconds ?? null,
    supaPlanningDurationSeconds: plan?.duration_seconds ?? null,
    planningDurationDeltaSeconds:
      baseline && plan ? plan.duration_seconds - baseline.duration_seconds : null,
    baselineExplicitMealDecisions: baseline?.explicit_meal_decisions ?? null,
    supaExplicitMealDecisions: plan?.explicit_meal_decisions ?? null,
    explicitMealDecisionDelta:
      baseline && plan ? plan.explicit_meal_decisions - baseline.explicit_meal_decisions : null,
    baselineManualEdits: baseline?.manual_edits ?? null,
    supaListEditCount: eventsOfType(session.events, 'list_edit_recorded').length,
    repairCount: repairCompletions.length,
    medianRepairDurationSeconds: median(repairCompletions.map((event) => event.duration_seconds)),
    repairManualEdits,
    planAdherence:
      knownMealOutcomes.length > 0 ? followedMeals / knownMealOutcomes.length : null,
    reusedLeftoverEvents: leftoverEvents.filter((event) => event.outcome === 'reused').length,
    wastedLeftoverEvents: leftoverEvents.filter((event) => event.outcome === 'wasted').length,
    remainingLeftoverEvents: leftoverEvents.filter((event) => event.outcome === 'remaining').length,
    unknownLeftoverEvents: leftoverEvents.filter((event) => event.outcome === 'unknown').length,
    basketOutcome: basket?.outcome ?? 'unknown',
    basketUnresolvedLineCount: basket?.unresolved_line_count ?? null,
    recommendationFollowed: recommendationDecision?.followed ?? null,
    explanationViewedBeforeDecision: recommendationDecision
      ? eventsOfType(session.events, 'basket_assessment_viewed').some(
          (event) => Date.parse(event.timestamp) <= Date.parse(recommendationDecision.timestamp),
        )
      : null,
    explanationTrustRating: trust?.rating_1_to_5 ?? null,
    uncertaintyUnderstood: trust?.uncertainty_understood ?? null,
    baselineEffortRating: baseline?.effort_rating ?? null,
    weeklyEffortRating: weeklyEffort?.rating_1_to_5 ?? null,
    returnIntentRating: close?.return_intent_1_to_5 ?? null,
    interviewComplete: close?.interview_complete ?? false,
    participantKeyIncluded: false,
    publicClaimEligible: false,
    evidenceBoundary:
      'Private beta evidence is directional and must retain positive, negative, abandoned and unknown outcomes; it is not a population-level product claim.',
  }
}

function parseArgs(argv) {
  const positional = []
  let output = null

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--output') {
      assert(output === null, '--output may only be provided once')
      const destination = argv[index + 1]
      assert(
        typeof destination === 'string' &&
          destination.trim().length > 0 &&
          !destination.startsWith('--'),
        '--output requires a non-flag file path',
      )
      output = destination
      index += 1
      continue
    }
    assert(!value.startsWith('--'), 'unrecognized option')
    positional.push(value)
  }

  assert(positional.length === 1, 'usage: m4-validate-beta-session <session.json> [--output summary.json]')
  return { input: positional[0], output }
}

// Private M4 summaries are immutable new artifacts. A fully written 0600
// temporary inode is hard-linked into place only when the destination is absent.
// link() fails with EEXIST for a source pathname, symlink, hardlink, or previously
// published report. It does not follow/overwrite the preexisting destination.
async function publishPrivateReport(output, serialized) {
  const temporary = join(
    dirname(output),
    `.${basename(output)}.${randomBytes(16).toString('hex')}.tmp`,
  )
  let handle = null
  let created = false
  try {
    handle = await open(temporary, 'wx', 0o600)
    created = true
    await handle.writeFile(serialized, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await link(temporary, output)
  } finally {
    if (handle) await handle.close()
    if (created) await unlink(temporary)
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { input, output } = parseArgs(argv)
  let session

  try {
    session = JSON.parse(await readFile(input, 'utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`session JSON could not be read/parsed: ${message}`)
  }

  const report = buildBetaSessionSummary(session)
  const serialized = `${JSON.stringify(report, null, 2)}\n`

  if (output) {
    await publishPrivateReport(output, serialized)
  } else {
    process.stdout.write(serialized)
  }

  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
