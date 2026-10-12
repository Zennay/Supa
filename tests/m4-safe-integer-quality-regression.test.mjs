import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateBetaSession, buildBetaSessionSummary } from '../scripts/m4-validate-beta-session.mjs'

// Synthetic-only QA: the M3 gate marker here is a fixture, not real beta authorization.
function fixture() {
  return {
    schemaVersion: 1,
    sessionType: 'm4-private-beta-session',
    sessionId: 'synthetic-qa-session',
    participantKey: 'synthetic-only',
    population: 'synthetic',
    sessionOutcome: 'unknown',
    consent: { researchConsent: true, allowsAnonymizedQuotes: false },
    m3Gate: { status: 'closed', evidenceRef: 'synthetic-test-only-not-real-evidence' },
    startedAt: '2026-01-01T00:00:00Z',
    endedAt: '2026-01-01T01:00:00Z',
    events: [{
      type: 'beta_session_started',
      timestamp: '2026-01-01T00:00:00Z',
      participant_id: 'synthetic-only',
      study_week_id: 'synthetic-week',
    }],
  }
}
function add(session, type, payload) {
  session.events.push({ type, timestamp: '2026-01-01T00:10:00Z', ...payload })
  return session
}
test('rejects unsafe M4 duration, decision count, manual edit and budget values', () => {
  const cases = [
    ['baseline_planning_completed', { duration_seconds: Number.MAX_SAFE_INTEGER + 1, explicit_meal_decisions: 0, manual_edits: 0, effort_rating: 3 }],
    ['baseline_planning_completed', { duration_seconds: 0, explicit_meal_decisions: Number.MAX_SAFE_INTEGER + 1, manual_edits: 0, effort_rating: 3 }],
    ['baseline_planning_completed', { duration_seconds: 0, explicit_meal_decisions: 0, manual_edits: Number.MAX_SAFE_INTEGER + 1, effort_rating: 3 }],
    ['plan_started', { budget_cents: Number.MAX_SAFE_INTEGER + 1, planned_days_count: 1 }],
    ['repair_completed', { repair_kind: 'synthetic', duration_seconds: 0, manual_edits: Number.MAX_SAFE_INTEGER + 1 }],
  ]
  for (const [type, payload] of cases) {
    assert.throws(() => validateBetaSession(add(fixture(), type, payload)), /integer|safe|range/i, type)
  }
})
test('rejects cumulative repair edit overflow even when individual edits are safe', () => {
  const session = fixture()
  add(session, 'repair_completed', { repair_kind: 'synthetic', duration_seconds: 0, manual_edits: Number.MAX_SAFE_INTEGER })
  add(session, 'repair_completed', { repair_kind: 'synthetic', duration_seconds: 0, manual_edits: 1 })
  assert.throws(() => buildBetaSessionSummary(session), /integer|safe|range|overflow/i)
})
test('zero remains valid and unknown outcomes cannot imply a public savings claim', () => {
  const session = add(fixture(), 'baseline_planning_completed', {
    duration_seconds: 0, explicit_meal_decisions: 0, manual_edits: 0, effort_rating: 3,
  })
  assert.equal(validateBetaSession(session), session)
  const summary = buildBetaSessionSummary(session)
  assert.equal(summary.sessionOutcome, 'unknown')
  assert.equal(summary.publicClaimEligible, false)
  assert.equal(JSON.stringify(summary).includes('synthetic-only'), false)
})
