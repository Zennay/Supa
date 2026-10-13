import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildBetaSessionSummary,
  validateBetaSession,
} from '../scripts/m4-validate-beta-session.mjs'

// Test-only abandoned M4 session; the fictional closed M3 record is only an
// internal validator precondition. It does not represent real human evidence.
function fictionalSession(overrides = {}) {
  return {
    schemaVersion: 1,
    sessionType: 'm4-private-beta-session',
    sessionId: 'opaque-qa-session-001',
    participantKey: 'synthetic-pseudonym-001',
    population: 'fictional out-of-home students',
    sessionOutcome: 'abandoned',
    consent: { researchConsent: true, allowsAnonymizedQuotes: false },
    m3Gate: { status: 'closed', evidenceRef: 'fictional-M3-gate-fixture-only' },
    startedAt: '2026-10-12T10:00:00.000Z',
    endedAt: '2026-10-12T10:05:00.000Z',
    events: [{
      type: 'beta_session_started',
      timestamp: '2026-10-12T10:00:00.000Z',
      participant_id: 'synthetic-pseudonym-001',
      study_week_id: 'fictional-week',
    }],
    ...overrides,
  }
}

const DIRECT_IDENTIFIER = 'fictional.person@example.invalid'

function assertNoDirectIdentifier(summary, context) {
  const serialized = JSON.stringify(summary)
  assert.doesNotMatch(serialized, /fictional\.person@example\.invalid/i,
    context + ': direct participant email must not appear in summary')
  assert.equal(summary.publicClaimEligible, false)
  assert.equal(summary.participantKeyIncluded, false)
}

test('positive: valid opaque session and generic population preserve private evidence boundaries', () => {
  const report = buildBetaSessionSummary(fictionalSession())
  assert.equal(report.sessionId, 'opaque-qa-session-001')
  assert.equal(report.population, 'fictional out-of-home students')
  assert.equal(report.sessionOutcome, 'abandoned')
  assertNoDirectIdentifier(report, 'safe fixture')
  assert.equal('participantKey' in report, false)
  assert.doesNotMatch(JSON.stringify(report), /synthetic-pseudonym-001/)
})

test('positive: missing genuine M3 clearance still blocks even non-sensitive M4 session', () => {
  const session = fictionalSession()
  session.m3Gate.status = 'open'
  assert.throws(
    () => validateBetaSession(session),
    /m3Gate\.status must be closed/,
  )
})

for (const [field, raw] of [
  ['sessionId', DIRECT_IDENTIFIER],
  ['sessionId', 'anonymous-session\nparticipant_email=' + DIRECT_IDENTIFIER],
  ['population', 'Target students — contact: ' + DIRECT_IDENTIFIER],
  ['population', 'Young students\nname=fictional.person@example.invalid'],
]) {
  test(`EXPECTED RED: M4 summary must reject direct identity in ${field} (${raw.includes('\\n') ? 'embedded' : 'plain'})`, () => {
    const session = fictionalSession({ [field]: raw })
    assert.throws(
      () => buildBetaSessionSummary(session),
      /privacy|identifier|email|unsafe|pseudonym|population|sessionId/i,
      'M4 summary creation must not echo direct participant identifiers into reported session metadata',
    )
  })
}
