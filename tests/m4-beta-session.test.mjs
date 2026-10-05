import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildBetaSessionSummary,
  validateBetaSession,
} from '../scripts/m4-validate-beta-session.mjs'

function validSession() {
  return {
    schemaVersion: 1,
    sessionType: 'm4-private-beta-session',
    sessionId: 'm4-session-001',
    participantKey: 'p-001',
    population: 'independently living student',
    sessionOutcome: 'completed',
    consent: {
      researchConsent: true,
      allowsAnonymizedQuotes: false,
    },
    m3Gate: {
      status: 'closed',
      evidenceRef: 'PWQ-14/AUD-003 evidence record',
    },
    startedAt: '2026-10-10T10:00:00.000Z',
    endedAt: '2026-10-17T20:00:00.000Z',
    events: [
      {
        type: 'beta_session_started',
        timestamp: '2026-10-10T10:00:00.000Z',
        participant_id: 'p-001',
        study_week_id: 'week-001',
      },
      {
        type: 'baseline_planning_completed',
        timestamp: '2026-10-10T10:20:00.000Z',
        duration_seconds: 1200,
        explicit_meal_decisions: 7,
        manual_edits: 5,
        effort_rating: 5,
      },
      {
        type: 'plan_started',
        timestamp: '2026-10-10T11:00:00.000Z',
        budget_cents: 5000,
        planned_days_count: 5,
      },
      {
        type: 'meal_decision_recorded',
        timestamp: '2026-10-10T11:02:00.000Z',
        meal_slot: 'monday-dinner',
        decision_kind: 'accepted-suggestion',
      },
      {
        type: 'meal_decision_recorded',
        timestamp: '2026-10-10T11:03:00.000Z',
        meal_slot: 'tuesday-dinner',
        decision_kind: 'swapped-suggestion',
      },
      {
        type: 'list_edit_recorded',
        timestamp: '2026-10-10T11:04:00.000Z',
        edit_kind: 'remove',
        item_key: 'ingredient-1',
      },
      {
        type: 'plan_completed',
        timestamp: '2026-10-10T11:10:00.000Z',
        duration_seconds: 600,
        planned_meals_count: 5,
        explicit_meal_decisions: 2,
      },
      {
        type: 'schedule_change_recorded',
        timestamp: '2026-10-12T17:00:00.000Z',
        change_kind: 'eating-out',
        affected_slot: 'wednesday-dinner',
      },
      {
        type: 'repair_started',
        timestamp: '2026-10-12T17:01:00.000Z',
        repair_kind: 'skip-meal',
      },
      {
        type: 'repair_completed',
        timestamp: '2026-10-12T17:04:00.000Z',
        repair_kind: 'skip-meal',
        duration_seconds: 180,
        manual_edits: 1,
      },
      {
        type: 'meal_outcome_recorded',
        timestamp: '2026-10-13T20:00:00.000Z',
        meal_slot: 'monday-dinner',
        outcome: 'followed',
      },
      {
        type: 'meal_outcome_recorded',
        timestamp: '2026-10-13T20:01:00.000Z',
        meal_slot: 'tuesday-dinner',
        outcome: 'swapped',
      },
      {
        type: 'meal_outcome_recorded',
        timestamp: '2026-10-13T20:02:00.000Z',
        meal_slot: 'wednesday-dinner',
        outcome: 'unknown',
      },
      {
        type: 'leftover_event_recorded',
        timestamp: '2026-10-14T20:00:00.000Z',
        ingredient_key: 'ingredient-2',
        outcome: 'reused',
      },
      {
        type: 'leftover_event_recorded',
        timestamp: '2026-10-15T20:00:00.000Z',
        ingredient_key: 'ingredient-3',
        outcome: 'wasted',
      },
      {
        type: 'basket_assessment_viewed',
        timestamp: '2026-10-16T12:00:00.000Z',
        outcome: 'unknown',
        unresolved_line_count: 1,
      },
      {
        type: 'basket_recommendation_decided',
        timestamp: '2026-10-16T12:01:00.000Z',
        followed: false,
        reason: 'preferred convenience over price',
      },
      {
        type: 'trust_rating_submitted',
        timestamp: '2026-10-17T18:00:00.000Z',
        rating_1_to_5: 4,
        uncertainty_understood: true,
      },
      {
        type: 'weekly_effort_submitted',
        timestamp: '2026-10-17T18:01:00.000Z',
        rating_1_to_5: 2,
      },
      {
        type: 'beta_week_closed',
        timestamp: '2026-10-17T19:00:00.000Z',
        return_intent_1_to_5: 4,
        interview_complete: true,
      },
    ],
  }
}

test('M4 beta validator derives privacy-safe metrics from the canonical event vocabulary', () => {
  const summary = buildBetaSessionSummary(validSession())

  assert.equal(summary.baselinePlanningDurationSeconds, 1200)
  assert.equal(summary.supaPlanningDurationSeconds, 600)
  assert.equal(summary.planningDurationDeltaSeconds, -600)
  assert.equal(summary.baselineExplicitMealDecisions, 7)
  assert.equal(summary.supaExplicitMealDecisions, 2)
  assert.equal(summary.explicitMealDecisionDelta, -5)
  assert.equal(summary.supaListEditCount, 1)
  assert.equal(summary.repairCount, 1)
  assert.equal(summary.medianRepairDurationSeconds, 180)
  assert.equal(summary.repairManualEdits, 1)
  assert.equal(summary.planAdherence, 0.5)
  assert.equal(summary.reusedLeftoverEvents, 1)
  assert.equal(summary.wastedLeftoverEvents, 1)
  assert.equal(summary.basketOutcome, 'unknown')
  assert.equal(summary.recommendationFollowed, false)
  assert.equal(summary.explanationViewedBeforeDecision, true)
  assert.equal(summary.explanationTrustRating, 4)
  assert.equal(summary.baselineEffortRating, 5)
  assert.equal(summary.weeklyEffortRating, 2)
  assert.equal(summary.returnIntentRating, 4)
  assert.equal(summary.participantKeyIncluded, false)
  assert.equal(summary.publicClaimEligible, false)
  assert.equal('participantKey' in summary, false)
})

test('M4 beta validator fails closed while the M3 gate is not closed', () => {
  const session = validSession()
  session.m3Gate.status = 'open'

  assert.throws(
    () => validateBetaSession(session),
    /m3Gate\.status must be closed before M4 beta data is accepted/,
  )
})

test('completed M4 sessions require both plan completion and week close evidence', () => {
  const noPlanCompletion = validSession()
  noPlanCompletion.events = noPlanCompletion.events.filter((event) => event.type !== 'plan_completed')

  assert.throws(
    () => validateBetaSession(noPlanCompletion),
    /completed sessions require a plan_completed event/,
  )

  const noWeekClose = validSession()
  noWeekClose.events = noWeekClose.events.filter((event) => event.type !== 'beta_week_closed')

  assert.throws(
    () => validateBetaSession(noWeekClose),
    /completed sessions require a beta_week_closed event/,
  )
})

test('abandoned sessions preserve partial evidence instead of fabricating completion', () => {
  const session = validSession()
  session.sessionOutcome = 'abandoned'
  session.events = session.events.filter(
    (event) => event.type !== 'plan_completed' && event.type !== 'beta_week_closed',
  )

  const summary = buildBetaSessionSummary(session)
  assert.equal(summary.sessionOutcome, 'abandoned')
  assert.equal(summary.supaPlanningDurationSeconds, null)
  assert.equal(summary.returnIntentRating, null)
})

test('ratings follow the canonical 1-to-5 protocol scale', () => {
  const session = validSession()
  const trust = session.events.find((event) => event.type === 'trust_rating_submitted')
  trust.rating_1_to_5 = 6

  assert.throws(
    () => validateBetaSession(session),
    /rating_1_to_5 must be an integer from 1 to 5/,
  )
})

test('event timestamps must remain inside the recorded study window', () => {
  const session = validSession()
  session.events[0].timestamp = '2026-10-01T00:00:00.000Z'

  assert.throws(
    () => validateBetaSession(session),
    /events\[0\]\.timestamp must fall inside the session window/,
  )
})


test('session start participant identity must match the pseudonymous participant key', () => {
  const session = validSession()
  session.events[0].participant_id = 'p-other'

  assert.throws(
    () => validateBetaSession(session),
    /beta_session_started\.participant_id must match participantKey/,
  )
})


test('M4 summary derives explanation-before-decision ordering without exposing free-text reasons', () => {
  const session = validSession()
  const basket = session.events.find((event) => event.type === 'basket_assessment_viewed')
  basket.timestamp = '2026-10-16T12:02:00.000Z'

  const summary = buildBetaSessionSummary(session)
  assert.equal(summary.recommendationFollowed, false)
  assert.equal(summary.explanationViewedBeforeDecision, false)
  assert.equal('recommendationReason' in summary, false)

  session.events = session.events.filter((event) => event.type !== 'basket_recommendation_decided')
  const noDecisionSummary = buildBetaSessionSummary(session)
  assert.equal(noDecisionSummary.recommendationFollowed, null)
  assert.equal(noDecisionSummary.explanationViewedBeforeDecision, null)
})
