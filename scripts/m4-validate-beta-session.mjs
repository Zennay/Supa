import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const EVENT_TYPES = new Set([
  'meal-decision',
  'list-edit',
  'plan-repair',
  'leftover-waste',
  'plan-completed',
])
const SESSION_OUTCOMES = new Set(['completed', 'abandoned', 'unknown'])
const BASKET_OUTCOMES = new Set(['better', 'same', 'worse', 'unknown'])

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

function requireBoolean(value, path) {
  assert(typeof value === 'boolean', `${path} must be a boolean`)
}

function requireNonNegativeInteger(value, path) {
  assert(Number.isInteger(value) && value >= 0, `${path} must be a non-negative integer`)
}

function requireScale(value, path) {
  assert(Number.isInteger(value) && value >= 1 && value <= 7, `${path} must be an integer from 1 to 7`)
}

function parseTimestamp(value, path) {
  requireString(value, path)
  const parsed = Date.parse(value)
  assert(Number.isFinite(parsed), `${path} must be a valid timestamp`)
  return parsed
}

function validateEvent(event, index, startedAt, endedAt) {
  const path = `events[${index}]`
  requireRecord(event, path)
  assert(EVENT_TYPES.has(event.type), `${path}.type is not an allowed M4 event type`)
  const at = parseTimestamp(event.at, `${path}.at`)
  assert(at >= startedAt && at <= endedAt, `${path}.at must fall inside the session window`)
  if (event.count !== undefined) {
    requireNonNegativeInteger(event.count, `${path}.count`)
    assert(event.count > 0, `${path}.count must be greater than zero when provided`)
  }
}

function eventCount(events, type) {
  return events
    .filter((event) => event.type === type)
    .reduce((total, event) => total + (event.count ?? 1), 0)
}

function firstEventTime(events, type) {
  const matching = events
    .filter((event) => event.type === type)
    .map((event) => Date.parse(event.at))
    .sort((a, b) => a - b)
  return matching.length > 0 ? matching[0] : null
}

export function validateBetaSession(input) {
  requireRecord(input, 'session')
  assert(input.schemaVersion === 1, 'schemaVersion must equal 1')
  assert(input.sessionType === 'm4-private-beta-session', 'sessionType must equal m4-private-beta-session')
  requireString(input.sessionId, 'sessionId')
  requireString(input.participantKey, 'participantKey')
  requireString(input.population, 'population')

  requireRecord(input.consent, 'consent')
  assert(input.consent.researchConsent === true, 'consent.researchConsent must be true')
  requireBoolean(input.consent.allowsAnonymizedQuotes, 'consent.allowsAnonymizedQuotes')

  requireRecord(input.m3Gate, 'm3Gate')
  assert(input.m3Gate.status === 'closed', 'm3Gate.status must be closed before M4 beta data is accepted')
  requireString(input.m3Gate.evidenceRef, 'm3Gate.evidenceRef')

  const startedAt = parseTimestamp(input.startedAt, 'startedAt')
  const endedAt = parseTimestamp(input.endedAt, 'endedAt')
  assert(endedAt >= startedAt, 'endedAt must not be before startedAt')

  assert(SESSION_OUTCOMES.has(input.sessionOutcome), 'sessionOutcome is not allowed')
  assert(BASKET_OUTCOMES.has(input.observedBasketOutcome), 'observedBasketOutcome is not allowed')

  requireRecord(input.plan, 'plan')
  requireNonNegativeInteger(input.plan.plannedMealCount, 'plan.plannedMealCount')
  requireNonNegativeInteger(input.plan.followedMealCount, 'plan.followedMealCount')
  assert(
    input.plan.followedMealCount <= input.plan.plannedMealCount,
    'plan.followedMealCount cannot exceed plan.plannedMealCount',
  )

  assert(Array.isArray(input.events), 'events must be an array')
  input.events.forEach((event, index) => validateEvent(event, index, startedAt, endedAt))

  const firstPlanCompletedAt = firstEventTime(input.events, 'plan-completed')
  if (input.sessionOutcome === 'completed') {
    assert(firstPlanCompletedAt !== null, 'completed sessions require a plan-completed event')
  }

  requireRecord(input.selfReport, 'selfReport')
  requireScale(input.selfReport.planningEffortBefore, 'selfReport.planningEffortBefore')
  requireScale(input.selfReport.planningEffortAfter, 'selfReport.planningEffortAfter')
  requireScale(input.selfReport.reuseAcceptability, 'selfReport.reuseAcceptability')
  requireScale(input.selfReport.explanationTrust, 'selfReport.explanationTrust')
  requireBoolean(input.selfReport.wouldUseAgain, 'selfReport.wouldUseAgain')

  if (input.qualitative !== undefined) {
    requireRecord(input.qualitative, 'qualitative')
    for (const [key, value] of Object.entries(input.qualitative)) {
      assert(
        typeof value === 'string',
        `qualitative.${key} must be a string when provided`,
      )
    }
  }

  return input
}

export function buildBetaSessionSummary(input) {
  const session = validateBetaSession(input)
  const startedAt = Date.parse(session.startedAt)
  const firstPlanCompletedAt = firstEventTime(session.events, 'plan-completed')
  const adherence =
    session.plan.plannedMealCount === 0
      ? null
      : session.plan.followedMealCount / session.plan.plannedMealCount

  return {
    schemaVersion: 1,
    reportType: 'm4-private-beta-session-summary',
    sessionId: session.sessionId,
    population: session.population,
    sessionOutcome: session.sessionOutcome,
    timeToFirstCompletePlanSeconds:
      firstPlanCompletedAt === null
        ? null
        : Math.round((firstPlanCompletedAt - startedAt) / 1000),
    manualListIngredientEdits: eventCount(session.events, 'list-edit'),
    explicitMealDecisions: eventCount(session.events, 'meal-decision'),
    planRepairCount: eventCount(session.events, 'plan-repair'),
    leftoverWasteEventCount: eventCount(session.events, 'leftover-waste'),
    plannedMealCount: session.plan.plannedMealCount,
    followedMealCount: session.plan.followedMealCount,
    plannedMealAdherence: adherence,
    planningEffortBefore: session.selfReport.planningEffortBefore,
    planningEffortAfter: session.selfReport.planningEffortAfter,
    reuseAcceptability: session.selfReport.reuseAcceptability,
    explanationTrust: session.selfReport.explanationTrust,
    wouldUseAgain: session.selfReport.wouldUseAgain,
    observedBasketOutcome: session.observedBasketOutcome,
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
      output = argv[index + 1] ?? null
      index += 1
      continue
    }
    positional.push(value)
  }

  assert(positional.length === 1, 'usage: m4-validate-beta-session <session.json> [--output summary.json]')
  assert(!output || output.trim().length > 0, '--output requires a file path')
  return { input: positional[0], output }
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
    await writeFile(output, serialized, 'utf8')
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
