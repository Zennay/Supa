import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildBetaSessionSummary,
  main,
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
  test(`EXPECTED RED: M4 summary must reject direct identity in ${field} (${raw.includes('\n') ? 'embedded' : 'plain'})`, () => {
    const session = fictionalSession({ [field]: raw })
    assert.throws(
      () => buildBetaSessionSummary(session),
      /privacy|identifier|email|unsafe|pseudonym|population|sessionId/i,
      'M4 summary creation must not echo direct participant identifiers into reported session metadata',
    )
  })
}

async function withSyntheticCliFiles(session, check) {
  const folder = await mkdtemp(join(tmpdir(), 'supa-m4-private-qa-'))
  const source = join(folder, 'fictional-session.json')
  const reportPath = join(folder, 'fictional-summary.json')
  try {
    await writeFile(source, JSON.stringify(session), 'utf8')
    await check(source, reportPath)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

test('positive: real M4 --output CLI serializes safe opaque data, not participant pseudonym', async () => {
  await withSyntheticCliFiles(fictionalSession(), async (source, reportPath) => {
    await main([source, '--output', reportPath])
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    assert.equal(report.sessionId, 'opaque-qa-session-001')
    assertNoDirectIdentifier(report, 'CLI positive')
    assert.doesNotMatch(JSON.stringify(report), /synthetic-pseudonym-001/)
  })
})

for (const field of ['sessionId', 'population']) {
  test(`EXPECTED RED: actual M4 --output must refuse direct-email ${field} before writing report`, async () => {
    const input = fictionalSession({
      [field]: field === 'sessionId'
        ? DIRECT_IDENTIFIER : 'fictional students: ' + DIRECT_IDENTIFIER,
    })
    await withSyntheticCliFiles(input, async (source, reportPath) => {
      await assert.rejects(
        () => main([source, '--output', reportPath]),
        /privacy|identifier|email|unsafe|pseudonym|population|sessionId/i,
        'output writer must reject private direct identifiers before file creation',
      )
      await assert.rejects(() => access(reportPath),
        /ENOENT/, 'rejected session must not leave private report on disk')
    })
  })
}
