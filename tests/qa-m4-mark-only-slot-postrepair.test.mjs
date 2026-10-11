import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildM4SummaryWithMealSlotIntegrity,
  validateM4MealSlotIntegrity,
} from '../scripts/m4-meal-slot-integrity.mjs'

// Independent synthetic acceptance on the exact #1335 fix. No real M3 closure.
function session(slots = [['monday', 'followed'], ['tuesday', 'skipped']]) {
  return {
    schemaVersion: 1,
    sessionType: 'm4-private-beta-session',
    sessionId: 'qa-acceptance',
    participantKey: 'private-synthetic-person',
    population: 'synthetic student',
    sessionOutcome: 'completed',
    consent: { researchConsent: true, allowsAnonymizedQuotes: false },
    m3Gate: { status: 'closed', evidenceRef: 'synthetic-not-M3-field-evidence' },
    startedAt: '2026-10-10T09:00:00Z',
    endedAt: '2026-10-17T22:00:00Z',
    events: [
      { type: 'beta_session_started', timestamp: '2026-10-10T09:00:00Z',
        participant_id: 'private-synthetic-person', study_week_id: 'qa-week' },
      { type: 'plan_completed', timestamp: '2026-10-10T10:00:00Z',
        duration_seconds: 400, planned_meals_count: 3, explicit_meal_decisions: 1 },
      ...slots.map(([meal_slot, outcome], index) => ({
        type: 'meal_outcome_recorded',
        timestamp: new Date(Date.parse('2026-10-15T12:00:00Z') + index * 1000).toISOString(),
        meal_slot, outcome,
      })),
      { type: 'beta_week_closed', timestamp: '2026-10-17T21:00:00Z',
        return_intent_1_to_5: 4, interview_complete: false },
    ],
  }
}

test('postrepair: NFKC must not turn apparent letter/symbol compatibility marks into standalone meal identities', () => {
  const cases = [
    '\uff9e', // halfwidth voiced sound mark -> combining kana voiced mark
    '\uff9f', // halfwidth semi-voiced sound mark -> combining kana mark
    '\u00b4', // spacing acute -> space + combining acute
    '\u00a8', // spacing diaeresis -> space + combining diaeresis
    '\u{1d185}', // musical combining stem
  ]
  for (const value of cases) {
    assert.equal(/[\p{L}\p{N}\p{P}\p{S}]/u.test(value.normalize('NFKC')), false)
    assert.throws(() => buildM4SummaryWithMealSlotIntegrity(session([[value, 'followed']])),
      /M4 meal outcome slot must include a visible base character/,
      JSON.stringify(value))
  }
})

test('postrepair: a valid NFKC-compatible base and accent-bearing meal ID still reconcile', () => {
  const valid = ['\uff21', 'Cafe\u0301', '\u30ab\u3099', '🍕\ufe0f', 'A\u20dd']
  for (const value of valid) {
    const input = session([[value, 'followed']])
    assert.equal(validateM4MealSlotIntegrity(input).events[2].meal_slot, value)
    assert.equal(buildM4SummaryWithMealSlotIntegrity(input).planAdherence, 1)
  }
  assert.throws(() => buildM4SummaryWithMealSlotIntegrity(session([
    ['\uff21', 'followed'], ['A', 'skipped'],
  ])), /exactly one final outcome/)
})

test('postrepair: late mark-only input rejects entire summary without mutating caller data', () => {
  const input = session([
    ...Array.from({ length: 40 }, (_, i) => ['slot-' + i, i % 2 ? 'skipped' : 'followed']),
    ['\uff9e', 'followed'],
  ])
  const original = structuredClone(input)
  assert.throws(() => buildM4SummaryWithMealSlotIntegrity(input),
    /M4 meal outcome slot must include a visible base character/)
  assert.deepEqual(input, original)
})

test('postrepair: valid measured and unknown outcomes retain private, nonclaimable reporting', () => {
  const report = buildM4SummaryWithMealSlotIntegrity(session([
    ['monday', 'followed'], ['tuesday', 'skipped'], ['wednesday', 'unknown'],
  ]))
  assert.equal(report.planAdherence, 0.5)
  assert.equal(report.sessionOutcome, 'completed')
  assert.equal(report.publicClaimEligible, false)
  assert.equal(report.participantKeyIncluded, false)
  assert.equal('participantKey' in report, false)
})
