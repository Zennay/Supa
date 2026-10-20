import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildBetaSessionSummary,
  validateBetaSession,
} from '../scripts/m4-validate-beta-session.mjs'

// This is NOT a real participant or M3 evidence record. Synthetic closed-gate
// precondition exists only to exercise the preparatory M4 validator.
function fakeSession({ outcome = 'unknown', unresolvedCount = 11 } = {}) {
  return {
    schemaVersion: 1,
    sessionType: 'm4-private-beta-session',
    sessionId: 'synthetic-m4-basket-001',
    participantKey: 'fictional-anonymous-key',
    population: 'fictional student',
    sessionOutcome: 'abandoned',
    consent: { researchConsent: true, allowsAnonymizedQuotes: false },
    m3Gate: { status: 'closed', evidenceRef: 'test-only-fake-m3-gate' },
    startedAt: '2026-10-12T08:00:00.000Z',
    endedAt: '2026-10-12T18:00:00.000Z',
    events: [
      {
        type: 'beta_session_started',
        timestamp: '2026-10-12T08:00:00.000Z',
        participant_id: 'fictional-anonymous-key',
        study_week_id: 'fictional-week',
      },
      {
        type: 'basket_assessment_viewed',
        timestamp: '2026-10-12T12:00:00.000Z',
        outcome,
        unresolved_line_count: unresolvedCount,
      },
    ],
  }
}

test('positive: incomplete M3 basket remains unknown and cannot support public savings', () => {
  const report = buildBetaSessionSummary(fakeSession())
  assert.equal(report.basketOutcome, 'unknown')
  assert.equal(report.basketUnresolvedLineCount, 11)
  assert.equal(report.sessionOutcome, 'abandoned')
  assert.equal(report.publicClaimEligible, false)
  assert.equal(report.participantKeyIncluded, false)
  assert.equal('participantKey' in report, false)
  assert.doesNotMatch(JSON.stringify(report), /fictional-anonymous-key/)
})

test('positive: no unresolved ingredients may record a private directional result', () => {
  for (const outcome of ['better', 'same', 'worse']) {
    const session = fakeSession({ outcome, unresolvedCount: 0 })
    const report = buildBetaSessionSummary(session)
    assert.equal(report.basketOutcome, outcome)
    assert.equal(report.basketUnresolvedLineCount, 0)
    assert.equal(report.publicClaimEligible, false)
    assert.equal('participantKey' in report, false)
  }
})

test('positive: no unresolved products does not force an unknown result to become positive', () => {
  const session = fakeSession({ outcome: 'unknown', unresolvedCount: 0 })
  const report = buildBetaSessionSummary(session)
  assert.equal(report.basketOutcome, 'unknown')
  assert.equal(report.publicClaimEligible, false)
})

test('positive: missing basket assessment cannot silently turn into certainty', () => {
  const session = fakeSession()
  session.events = session.events.filter((event) => event.type !== 'basket_assessment_viewed')
  const report = buildBetaSessionSummary(session)
  assert.equal(report.basketOutcome, 'unknown')
  assert.equal(report.basketUnresolvedLineCount, null)
  assert.equal(report.publicClaimEligible, false)
})

for (const definiteOutcome of ['better', 'same', 'worse']) {
  for (const unresolvedCount of [1, 11]) {
    test(`EXPECTED RED: ${definiteOutcome} cannot be claimed with ${unresolvedCount} unresolved product(s)`, () => {
      const session = fakeSession({ outcome: definiteOutcome, unresolvedCount })
      assert.throws(
        () => validateBetaSession(session),
        /basket|unresolved|outcome|contradict|unknown/i,
        'M4 should reject a definitive M3 basket outcome when any required line is still unresolved',
      )
    })
  }
}
