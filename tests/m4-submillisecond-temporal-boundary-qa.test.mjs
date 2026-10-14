import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildBetaSessionSummary,
  validateBetaSession,
} from '../scripts/m4-validate-beta-session.mjs'

// Synthetic only. No real study, source permission, M3 closure or beta authorization.
function syntheticAbandonedSession() {
  return {
    schemaVersion: 1,
    sessionType: 'm4-private-beta-session',
    sessionId: 'synthetic-session',
    participantKey: 'synthetic-participant',
    population: 'fictional student',
    sessionOutcome: 'abandoned',
    consent: { researchConsent: true, allowsAnonymizedQuotes: false },
    // Fixture precondition ONLY; real M3 gate #78 is still OPEN.
    m3Gate: { status: 'closed', evidenceRef: 'synthetic-non-evidence' },
    startedAt: '2026-10-12T09:00:00.000Z',
    endedAt: '2026-10-12T11:00:00.000Z',
    events: [
      {
        type: 'beta_session_started',
        timestamp: '2026-10-12T09:00:00.000Z',
        participant_id: 'synthetic-participant',
        study_week_id: 'synthetic-week',
      },
      {
        type: 'basket_assessment_viewed',
        timestamp: '2026-10-12T10:00:00.000Z',
        outcome: 'unknown',
        unresolved_line_count: 11,
      },
      {
        type: 'basket_recommendation_decided',
        timestamp: '2026-10-12T10:00:00.001Z',
        followed: false,
        reason: 'fictional unknown basket',
      },
    ],
  }
}

test('positive control: exact millisecond event chronology is accepted privately', () => {
  const session = syntheticAbandonedSession()
  const summary = buildBetaSessionSummary(session)
  assert.equal(summary.explanationViewedBeforeDecision, true)
  assert.equal(summary.sessionOutcome, 'abandoned')
  assert.equal(summary.basketOutcome, 'unknown')
  assert.equal(summary.publicClaimEligible, false)
  assert.equal(summary.participantKeyIncluded, false)
  assert.equal(JSON.stringify(summary).includes('synthetic-participant'), false)
})

test('positive control: reversed exact millisecond explanation order is false', () => {
  const session = syntheticAbandonedSession()
  session.events[1].timestamp = '2026-10-12T10:00:00.002Z'
  const summary = buildBetaSessionSummary(session)
  assert.equal(summary.explanationViewedBeforeDecision, false)
  assert.equal(summary.publicClaimEligible, false)
})

test('EXPECTED RED: session end 0.8 ms before start is not a valid window', () => {
  const session = syntheticAbandonedSession()
  session.startedAt = '2026-10-12T10:00:00.0009Z'
  session.endedAt = '2026-10-12T10:00:00.0001Z'
  session.events = [{
    type: 'beta_session_started',
    timestamp: session.startedAt,
    participant_id: session.participantKey,
    study_week_id: 'synthetic-week',
  }]
  assert.throws(
    () => validateBetaSession(session),
    /endedAt|timestamp|precision|session window/i,
    'Do not let Date.parse silently collapse an inverted sub-ms window',
  )
})

test('EXPECTED RED: an event 0.8 ms after the end must fail the session window', () => {
  const session = syntheticAbandonedSession()
  session.endedAt = '2026-10-12T10:00:00.0001Z'
  session.events[1].timestamp = '2026-10-12T10:00:00.0009Z'
  session.events[2].timestamp = '2026-10-12T09:30:00.000Z'
  assert.throws(
    () => validateBetaSession(session),
    /timestamp|precision|session window/i,
    'Event after end is not in window, even if Date.parse rounds both to the same ms',
  )
})

test('EXPECTED RED: a decision preceding explanation within a millisecond is not explained', () => {
  const session = syntheticAbandonedSession()
  session.events[1].timestamp = '2026-10-12T10:00:00.0009Z'
  session.events[2].timestamp = '2026-10-12T10:00:00.0001Z'
  // Either reject the unsupported >ms timestamps, OR retain their exact ordering.
  // Never report explanation-before-decision true for an explanation that occurs later.
  try {
    const summary = buildBetaSessionSummary(session)
    assert.equal(
      summary.explanationViewedBeforeDecision,
      false,
      'No false-positive explanation-before-decision evidence from floored timestamps',
    )
    assert.equal(summary.publicClaimEligible, false)
  } catch (error) {
    // Rejecting sub-millisecond metadata up front is a valid fail-closed repair.
    if (error instanceof assert.AssertionError) throw error
    assert.match(String(error), /timestamp|precision|fraction|millisecond/i)
  }
})


test('EXPECTED RED: latest real basket observation must not regress to older optimistic result', () => {
  const session = syntheticAbandonedSession()
  // A later unknown observation appears before the earlier "better" one in the
  // input array. Actual ordering (900 microseconds > 100 microseconds) matters.
  session.events = [
    session.events[0],
    {
      type: 'basket_assessment_viewed',
      timestamp: '2026-10-12T10:00:00.0009Z',
      outcome: 'unknown',
      unresolved_line_count: 11,
    },
    {
      type: 'basket_assessment_viewed',
      timestamp: '2026-10-12T10:00:00.0001Z',
      outcome: 'better',
      unresolved_line_count: 0,
    },
  ]
  // Rejecting unrepresentable precision is also a valid source repair.
  try {
    const summary = buildBetaSessionSummary(session)
    assert.equal(
      summary.basketOutcome,
      'unknown',
      'The latest real observation is unresolved; an older optimistic event must not win',
    )
    assert.equal(summary.publicClaimEligible, false)
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error
    assert.match(String(error), /timestamp|precision|fraction|millisecond/i)
  }
})
