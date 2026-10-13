import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildBetaSessionSummary, validateBetaSession } from '../scripts/m4-validate-beta-session.mjs'

// Everything here is fictional; 'closed' M3 is a test precondition, not real
// PLUS/DekaMarkt evidence or permission for participant recruitment.
function fixture(sessionOutcome = 'completed') {
  const events = [
    { type: 'beta_session_started', timestamp: '2026-10-10T10:00:00Z', participant_id: 'synthetic-pseudo', study_week_id: 'fake-week' },
    { type: 'plan_started', timestamp: '2026-10-10T10:05:00Z', budget_cents: 4500, planned_days_count: 5 },
    { type: 'plan_completed', timestamp: '2026-10-10T10:10:00Z', duration_seconds: 300, planned_meals_count: 5, explicit_meal_decisions: 2 },
    { type: 'meal_outcome_recorded', timestamp: '2026-10-11T12:00:00Z', meal_slot: 'monday-dinner', outcome: 'followed' },
  ]
  if (sessionOutcome === 'completed') {
    events.push({ type: 'beta_week_closed', timestamp: '2026-10-17T19:00:00Z', return_intent_1_to_5: 4, interview_complete: false })
  }
  return {
    schemaVersion: 1,
    sessionType: 'm4-private-beta-session',
    sessionId: 'synthetic-lifecycle-session',
    participantKey: 'synthetic-pseudo',
    population: 'fictional cohort',
    sessionOutcome,
    consent: { researchConsent: true, allowsAnonymizedQuotes: false },
    m3Gate: { status: 'closed', evidenceRef: 'fake-gate-not-field-proof' },
    startedAt: '2026-10-10T09:00:00Z',
    endedAt: '2026-10-17T20:00:00Z',
    events,
  }
}

function noEarlyActivity(input) {
  const original = JSON.stringify(input)
  assert.throws(() => validateBetaSession(input), /events must not precede beta_session_started/)
  assert.equal(JSON.stringify(input), original)
}

test('M4 accepts a valid fictional event sequence after actual beta start', () => {
  const data = fixture()
  const original = JSON.stringify(data)
  const report = buildBetaSessionSummary(data)
  assert.equal(report.supaPlanningDurationSeconds, 300)
  assert.equal(report.planAdherence, 1)
  assert.equal(report.publicClaimEligible, false)
  assert.equal('participantKey' in report, false)
  assert.equal(JSON.stringify(data), original)
})

test('M4 permits legitimate activity exactly at the start timestamp', () => {
  const data = fixture()
  data.events[1].timestamp = data.events[0].timestamp
  assert.equal(buildBetaSessionSummary(data).sessionOutcome, 'completed')
})

test('M4 accepts event arrays out of order when timestamps remain causal', () => {
  const data = fixture()
  data.events.reverse()
  assert.equal(buildBetaSessionSummary(data).planAdherence, 1)
})

for (const [label, edit] of [
  ['planning starts before beta started', (x) => { x.events[1].timestamp = '2026-10-10T09:20:00Z' }],
  ['meal outcome before beta started', (x) => { x.events[3].timestamp = '2026-10-10T09:30:00Z' }],
  ['baseline planning evidence before beta started', (x) => { x.events.push({ type: 'baseline_planning_completed', timestamp: '2026-10-10T09:15:00Z', duration_seconds: 300, explicit_meal_decisions: 2, manual_edits: 1, effort_rating: 4 }) }],
  ['start event recorded late although outer startedAt is early', (x) => { x.events[0].timestamp = '2026-10-10T10:06:00Z' }],
]) {
  test(`M4 rejects valid-window activity preceding actual start: ${label}`, () => {
    const data = fixture()
    edit(data)
    noEarlyActivity(data)
  })
}

for (const outcome of ['abandoned', 'unknown']) {
  test(`M4 refuses pre-start evidence even if ${outcome} session is incomplete`, () => {
    const data = fixture(outcome)
    data.events[3].timestamp = '2026-10-10T09:05:00Z'
    noEarlyActivity(data)
  })
  test(`M4 keeps valid partial ${outcome} evidence without fake closure`, () => {
    const data = fixture(outcome)
    const summary = buildBetaSessionSummary(data)
    assert.equal(summary.sessionOutcome, outcome)
    assert.equal(summary.returnIntentRating, null)
    assert.equal(summary.publicClaimEligible, false)
  })
}

test('M4 CLI refuses pre-start private evidence before creating derived report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m4-early-event-'))
  try {
    const source = join(directory, 'source.json')
    const target = join(directory, 'report.json')
    const input = fixture()
    input.events[1].timestamp = '2026-10-10T09:20:00Z'
    const original = JSON.stringify(input)
    await writeFile(source, original, { mode: 0o600 })
    const run = spawnSync(process.execPath, [
      'scripts/m4-validate-beta-session.mjs', source, '--output', target,
    ], { cwd: process.cwd(), encoding: 'utf8' })
    assert.equal(run.status, 1)
    assert.equal(run.stdout, '')
    assert.match(run.stderr, /events must not precede beta_session_started/)
    assert.doesNotMatch(run.stderr, /synthetic-pseudo|fictional cohort/)
    await assert.rejects(readFile(target, 'utf8'), /ENOENT/)
    assert.equal(await readFile(source, 'utf8'), original)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
