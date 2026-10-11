import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildM4SummaryWithMealSlotIntegrity,
  validateM4MealSlotIntegrity,
} from '../scripts/m4-meal-slot-integrity.mjs'

// Synthetic QA only. This "closed" M3 marker does NOT establish the genuine
// PLUS/DekaMarkt field gate or authorize collection of M4 participant data.
function fixture(mealSlot = 'monday-dinner') {
  return {
    schemaVersion: 1,
    sessionType: 'm4-private-beta-session',
    sessionId: 'synthetic-mark-slot',
    participantKey: 'synthetic-person',
    population: 'synthetic student',
    sessionOutcome: 'completed',
    consent: { researchConsent: true, allowsAnonymizedQuotes: false },
    m3Gate: { status: 'closed', evidenceRef: 'synthetic-not-real-m3-proof' },
    startedAt: '2026-10-10T09:00:00Z',
    endedAt: '2026-10-17T22:00:00Z',
    events: [
      {
        type: 'beta_session_started', timestamp: '2026-10-10T09:00:00Z',
        participant_id: 'synthetic-person', study_week_id: 'synthetic-week',
      },
      {
        type: 'plan_completed', timestamp: '2026-10-10T10:00:00Z',
        duration_seconds: 300, planned_meals_count: 1, explicit_meal_decisions: 1,
      },
      {
        type: 'meal_outcome_recorded', timestamp: '2026-10-15T12:00:00Z',
        meal_slot: mealSlot, outcome: 'followed',
      },
      {
        type: 'beta_week_closed', timestamp: '2026-10-17T21:00:00Z',
        return_intent_1_to_5: 4, interview_complete: false,
      },
    ],
  }
}

test('QA #1325 RED: mark-only M4 meal slots are not perceptible meal identities', async (t) => {
  const invisibleOnly = [
    ['combining acute accent', '\u0301'],
    ['combining enclosing circle', '\u20dd'],
    ['Devanagari spacing mark', '\u0903'],
    ['combining doubled circumflex', '\u1ab0'],
    ['variation selector-16', '\ufe0f'],
    ['supplementary variation selector', '\u{e0100}'],
  ]

  for (const [description, mark] of invisibleOnly) {
    await t.test(description, () => {
      const input = fixture(mark)
      const original = structuredClone(input)
      assert.throws(
        () => buildM4SummaryWithMealSlotIntegrity(input),
        /M4 meal outcome slot/,
        'must not count an isolated modifier as a real planned meal',
      )
      assert.deepEqual(input, original)
    })
  }
})

test('QA #1325: legitimate letters, combining accents and symbols remain acceptable', () => {
  for (const text of ['monday', 'cafe\u0301', 'é', '🍕\ufe0f', '1', 'A', '♪', '-']) {
    const input = fixture(text)
    assert.equal(validateM4MealSlotIntegrity(input).events[2].meal_slot, text)
    const summary = buildM4SummaryWithMealSlotIntegrity(input)
    assert.equal(summary.planAdherence, 1)
    assert.equal(summary.publicClaimEligible, false)
    assert.equal('participantKey' in summary, false)
  }
})

test('QA #1325: a mixed visible-base slot retains its original normalized identity', () => {
  const input = fixture('cafe\u0301')
  const snapshot = validateM4MealSlotIntegrity(input)
  assert.equal(snapshot.events[2].meal_slot, 'cafe\u0301')
  assert.notStrictEqual(snapshot, input)
  assert.equal(input.events[2].meal_slot, 'cafe\u0301')
})
