import assert from 'node:assert/strict'
import test from 'node:test'

import { buildBetaSessionSummary } from '../scripts/m4-validate-beta-session.mjs'
import {
  buildM4SummaryWithMealSlotIntegrity,
  validateM4MealSlotIntegrity,
} from '../scripts/m4-meal-slot-integrity.mjs'

function session(outcomes = [
  ['monday-dinner', 'followed'],
  ['tuesday-dinner', 'skipped'],
  ['wednesday-dinner', 'unknown'],
]) {
  return {
    schemaVersion: 1,
    sessionType: 'm4-private-beta-session',
    sessionId: 'synthetic-session-1',
    participantKey: 'synthetic-person-1',
    population: 'synthetic student',
    sessionOutcome: 'completed',
    consent: { researchConsent: true, allowsAnonymizedQuotes: false },
    // Synthetic control ONLY: not proof PWQ-14 / AUD-003 has closed.
    m3Gate: { status: 'closed', evidenceRef: 'synthetic-test-marker-not-evidence' },
    startedAt: '2026-10-10T09:00:00Z',
    endedAt: '2026-10-17T22:00:00Z',
    events: [
      { type: 'beta_session_started', timestamp: '2026-10-10T09:00:00Z',
        participant_id: 'synthetic-person-1', study_week_id: 'synthetic-week-1' },
      { type: 'plan_completed', timestamp: '2026-10-10T10:00:00Z',
        duration_seconds: 450, planned_meals_count: 3, explicit_meal_decisions: 2 },
      ...outcomes.map(([meal_slot, outcome], index) => ({
        type: 'meal_outcome_recorded', timestamp: new Date(
          Date.parse('2026-10-15T12:00:00Z') + index * 1000,
        ).toISOString(), meal_slot, outcome,
      })),
      { type: 'beta_week_closed', timestamp: '2026-10-17T21:00:00Z',
        return_intent_1_to_5: 3, interview_complete: false },
    ],
  }
}

test('QA M4: default summary overweights duplicate per-slot outcome updates (known source gap)', () => {
  const input = session([
    ['monday-dinner', 'followed'],
    ['monday-dinner', 'followed'],
    ['tuesday-dinner', 'skipped'],
  ])
  assert.equal(buildBetaSessionSummary(input).planAdherence, 2 / 3)
  assert.throws(() => buildM4SummaryWithMealSlotIntegrity(input),
    /exactly one final outcome/)
})

test('QA M4: a conflicting duplicate outcome cannot silently bias a final denominator', () => {
  for (const second of ['followed', 'skipped', 'swapped', 'unknown']) {
    const input = session([
      ['monday-dinner', 'followed'],
      ['tuesday-dinner', 'skipped'],
      ['monday-dinner', second],
    ])
    assert.throws(() => buildM4SummaryWithMealSlotIntegrity(input),
      /exactly one final outcome/, second)
  }
})

test('QA M4: unknown followed by a known correction on the same slot is ambiguous too', () => {
  assert.throws(() => buildM4SummaryWithMealSlotIntegrity(session([
    ['monday-dinner', 'unknown'], ['monday-dinner', 'followed'],
  ])), /exactly one final outcome/)
})

test('QA M4: distinct known and unknown slots retain measured-only adherence', () => {
  const input = session()
  const original = structuredClone(input)
  const report = buildM4SummaryWithMealSlotIntegrity(input)
  assert.equal(report.planAdherence, 0.5)
  assert.equal(report.sessionOutcome, 'completed')
  assert.equal(report.publicClaimEligible, false)
  assert.equal(report.participantKeyIncluded, false)
  assert.equal('participantKey' in report, false)
  assert.deepEqual(input, original)
})

test('QA M4: all-known, unknown-only and no-outcome states remain distinct', () => {
  assert.equal(buildM4SummaryWithMealSlotIntegrity(session([
    ['monday-dinner', 'followed'],
  ])).planAdherence, 1)
  assert.equal(buildM4SummaryWithMealSlotIntegrity(session([
    ['monday-dinner', 'skipped'],
  ])).planAdherence, 0)
  assert.equal(buildM4SummaryWithMealSlotIntegrity(session([
    ['monday-dinner', 'unknown'],
  ])).planAdherence, null)
  assert.equal(buildM4SummaryWithMealSlotIntegrity(session([])).planAdherence, null)
})

test('QA M4: NFC/NFKC display-equivalent meal slot labels cannot duplicate', () => {
  const cases = [['café', 'cafe\u0301'], ['monday-Ａ', 'monday-A']]
  for (const [a, b] of cases) {
    assert.throws(() => buildM4SummaryWithMealSlotIntegrity(session([
      [a, 'followed'], [b, 'skipped'],
    ])), /exactly one final outcome/)
  }
})

test('QA M4: noncanonical or invisible meal slot labels fail before summary', () => {
  for (const slot of [' monday', 'monday ', '', '\u200b=SUM(1)', 'monday\nslot', 'monday\u202eslot', 'x'.repeat(257)]) {
    assert.throws(() => buildM4SummaryWithMealSlotIntegrity(session([[slot, 'followed']])),
      /meal outcome slot|meal_slot must be a non-empty string/, JSON.stringify(slot))
  }
})

test('QA M4: late duplicate is rejected without changing caller-owned events', () => {
  const input = session(Array.from({ length: 25 }, (_, i) => [
    `day-${i}`, i % 2 ? 'skipped' : 'followed',
  ]).concat([['day-0', 'followed']]))
  const copy = structuredClone(input)
  assert.throws(() => buildM4SummaryWithMealSlotIntegrity(input),
    /exactly one final outcome/)
  assert.deepEqual(input, copy)
})

test('QA M4: session evidence must be dense plain JSON data, not executable accessors', () => {
  const input = session()
  let getterInvoked = 0
  Object.defineProperty(input.events.at(-2), 'meal_slot', {
    enumerable: true,
    get() { getterInvoked += 1; return 'monday-dinner' },
  })
  assert.throws(() => validateM4MealSlotIntegrity(input), /accessors are not accepted/)
  assert.equal(getterInvoked, 0)
  const sparse = session()
  delete sparse.events[1]
  assert.throws(() => validateM4MealSlotIntegrity(sparse), /dense data arrays/)
})

test('QA M4: malformed non-JSON numeric and unsupported events fail before reporting', () => {
  const input = session()
  input.events[1].planned_meals_count = Number.MAX_SAFE_INTEGER + 2
  assert.throws(() => buildM4SummaryWithMealSlotIntegrity(input),
    /plain JSON data|bounded JSON budget/)
  const invalid = session()
  invalid.events[2].outcome = 'VERIFIED'
  assert.throws(() => buildM4SummaryWithMealSlotIntegrity(invalid),
    /not an allowed value/)
})

test('QA M4: a large aggregate payload is refused before any adherence report', () => {
  const events = Array.from({ length: 160 }, (_, i) => [
    `synthetic-slot-${i}`, i % 2 === 0 ? 'followed' : 'skipped',
  ])
  const input = session(events)
  const longText = '🔒'.repeat(2048)
  for (const event of input.events) {
    if (event.type === 'meal_outcome_recorded') {
      event.extraSyntheticMetadata = longText
    }
  }
  const original = structuredClone(input)
  assert.throws(
    () => buildM4SummaryWithMealSlotIntegrity(input),
    /aggregate UTF-8 byte budget/,
  )
  assert.deepEqual(input, original)
})

test('QA M4: abandoned/partial weeks preserve missing measures as unknown', () => {
  const input = session([])
  input.sessionOutcome = 'abandoned'
  input.events = input.events.filter((event) =>
    event.type !== 'plan_completed' && event.type !== 'beta_week_closed')
  const report = buildM4SummaryWithMealSlotIntegrity(input)
  assert.equal(report.sessionOutcome, 'abandoned')
  assert.equal(report.supaPlanningDurationSeconds, null)
  assert.equal(report.planAdherence, null)
  assert.equal(report.returnIntentRating, null)
  assert.equal(report.publicClaimEligible, false)
})

test('QA M4: M3 gate still denies actual beta execution without the signed prerequisite', () => {
  const input = session()
  input.m3Gate.status = 'open'
  assert.throws(() => buildM4SummaryWithMealSlotIntegrity(input),
    /m3Gate.status must be closed/)
})
