import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  buildBetaSessionSummary,
  validateBetaSession,
} from '../scripts/m4-validate-beta-session.mjs'

// All evidence here is fictional. This is NOT an actual closed M3 gate or a beta participant.
function fictionalCompletedSession() {
  return {
    schemaVersion: 1,
    sessionType: 'm4-private-beta-session',
    sessionId: 'synthetic-m4-sequence',
    participantKey: 'synthetic-participant',
    population: 'fictional adults in a QA fixture',
    sessionOutcome: 'completed',
    consent: { researchConsent: true, allowsAnonymizedQuotes: false },
    m3Gate: { status: 'closed', evidenceRef: 'fictional-closed-gate-fixture' },
    startedAt: '2026-10-10T10:00:00.000Z',
    endedAt: '2026-10-17T20:00:00.000Z',
    events: [
      {
        type: 'beta_session_started',
        timestamp: '2026-10-10T10:00:00.000Z',
        participant_id: 'synthetic-participant',
        study_week_id: 'fictional-week',
      },
      {
        type: 'plan_started',
        timestamp: '2026-10-10T10:20:00.000Z',
        budget_cents: 5000,
        planned_days_count: 3,
      },
      {
        type: 'plan_completed',
        timestamp: '2026-10-10T11:00:00.000Z',
        duration_seconds: 600,
        planned_meals_count: 3,
        explicit_meal_decisions: 3,
      },
      {
        type: 'beta_week_closed',
        timestamp: '2026-10-17T19:00:00.000Z',
        return_intent_1_to_5: 3,
        interview_complete: false,
      },
    ],
  }
}

function event(session, type) {
  const found = session.events.find((entry) => entry.type === type)
  assert.ok(found, `fixture must include ${type}`)
  return found
}

test('M4 causal-lifecycle positive: fictional complete week has one ordered start, plan and closure', () => {
  const fixture = fictionalCompletedSession()
  assert.equal(validateBetaSession(fixture), fixture)
  const report = buildBetaSessionSummary(fixture)
  assert.equal(report.sessionOutcome, 'completed')
  assert.equal(report.supaPlanningDurationSeconds, 600)
  assert.equal(report.returnIntentRating, 3)
  assert.equal(report.publicClaimEligible, false)
  assert.equal(report.participantKeyIncluded, false)
  assert.equal(JSON.stringify(report).includes(fixture.participantKey), false)
})

test('M4 causal-lifecycle positive: abandoned and unknown weeks preserve partial evidence', () => {
  for (const sessionOutcome of ['abandoned', 'unknown']) {
    const fixture = fictionalCompletedSession()
    fixture.sessionOutcome = sessionOutcome
    fixture.events = fixture.events.filter((entry) => entry.type === 'beta_session_started')

    const report = buildBetaSessionSummary(fixture)
    assert.equal(report.sessionOutcome, sessionOutcome)
    assert.equal(report.supaPlanningDurationSeconds, null)
    assert.equal(report.returnIntentRating, null)
    assert.equal(report.publicClaimEligible, false)
    assert.equal(report.participantKeyIncluded, false)
  }
})

test('M4 causal-lifecycle positive: real CLI can still emit a private fictional closed-week summary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m4-causal-green-'))
  const source = join(directory, 'fictional-valid-session.json')
  const output = join(directory, 'private-report.json')
  try {
    const fixture = fictionalCompletedSession()
    await writeFile(source, JSON.stringify(fixture), { mode: 0o600 })
    const run = spawnSync(
      process.execPath,
      ['scripts/m4-validate-beta-session.mjs', source, '--output', output],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.stdout, '')
    const report = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(report.sessionOutcome, 'completed')
    assert.equal(report.publicClaimEligible, false)
    assert.equal('participantKey' in report, false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('M4 causal-lifecycle negative: completed plan cannot lack a start event', () => {
  const fixture = fictionalCompletedSession()
  fixture.events = fixture.events.filter((entry) => entry.type !== 'plan_started')
  assert.throws(() => validateBetaSession(fixture))
})

test('M4 causal-lifecycle negative: completed plan cannot precede its recorded start', () => {
  const fixture = fictionalCompletedSession()
  event(fixture, 'plan_started').timestamp = '2026-10-10T11:20:00.000Z'
  assert.throws(() => validateBetaSession(fixture))
})

test('M4 causal-lifecycle negative: closed beta week cannot predate plan completion', () => {
  const fixture = fictionalCompletedSession()
  event(fixture, 'beta_week_closed').timestamp = '2026-10-10T10:30:00.000Z'
  assert.throws(() => validateBetaSession(fixture))
})

test('M4 causal-lifecycle negative: post-close events inside outer session window must not count', () => {
  const fixture = fictionalCompletedSession()
  fixture.events.push({
    type: 'meal_outcome_recorded',
    timestamp: '2026-10-17T19:30:00.000Z',
    meal_slot: 'fictional-monday-dinner',
    outcome: 'followed',
  })
  assert.throws(() => validateBetaSession(fixture))
})

test('M4 causal-lifecycle negative: a completed beta week cannot close twice', () => {
  const fixture = fictionalCompletedSession()
  fixture.events.push({
    ...event(fixture, 'beta_week_closed'),
    timestamp: '2026-10-17T19:15:00.000Z',
  })
  assert.throws(() => validateBetaSession(fixture))
})

test('M4 causal-lifecycle CLI: impossible sequence never publishes private report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m4-causal-'))
  const source = join(directory, 'fictional-session.json')
  const output = join(directory, 'private-report.json')
  try {
    const fixture = fictionalCompletedSession()
    fixture.events = fixture.events.filter((entry) => entry.type !== 'plan_started')
    await writeFile(source, JSON.stringify(fixture), { mode: 0o600 })

    const run = spawnSync(
      process.execPath,
      ['scripts/m4-validate-beta-session.mjs', source, '--output', output],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    assert.equal(run.status, 1, 'missing plan_started must exit nonzero')
    assert.equal(run.stdout, '', 'invalid session must never emit a report to stdout')
    assert.equal(run.stderr.includes(fixture.participantKey), false)
    await assert.rejects(readFile(output, 'utf8'), /ENOENT/)
    assert.equal((await readFile(source, 'utf8')).includes('"plan_started"'), false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
