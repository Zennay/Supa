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

// Entirely invented research records. The M3 gate in this fixture is fictional;
// it does not authorize any actual beta participant, retailer access or claims.
function sample() {
  return {
    schemaVersion: 1,
    sessionType: 'm4-private-beta-session',
    sessionId: 'fictional-week-001',
    participantKey: 'opaque-fixture-pseudo',
    population: 'invented research cohort',
    sessionOutcome: 'completed',
    consent: { researchConsent: true, allowsAnonymizedQuotes: false },
    m3Gate: { status: 'closed', evidenceRef: 'synthetic-only-m3-gate' },
    startedAt: '2026-10-10T12:00:00Z',
    endedAt: '2026-10-17T20:00:00Z',
    events: [
      { type: 'beta_session_started', timestamp: '2026-10-10T12:00:00Z', participant_id: 'opaque-fixture-pseudo', study_week_id: 'fictional-week' },
      { type: 'plan_started', timestamp: '2026-10-10T12:01:00Z', budget_cents: 5000, planned_days_count: 5 },
      { type: 'plan_completed', timestamp: '2026-10-10T12:05:00Z', duration_seconds: 240, planned_meals_count: 5, explicit_meal_decisions: 3 },
      { type: 'repair_started', timestamp: '2026-10-11T12:10:00Z', repair_kind: 'skip-meal' },
      { type: 'repair_completed', timestamp: '2026-10-11T12:13:00Z', repair_kind: 'skip-meal', duration_seconds: 180, manual_edits: 2 },
      { type: 'beta_week_closed', timestamp: '2026-10-17T19:00:00Z', return_intent_1_to_5: 4, interview_complete: false },
    ],
  }
}
function mutate(input, kind, callback) {
  const event = input.events.find((entry) => entry.type === kind)
  assert.ok(event)
  callback(event)
  return input
}
function invalid(mutator, pattern = /plan|clos|repair|caus/i) {
  const input = mutator(sample())
  const before = JSON.stringify(input)
  assert.throws(() => validateBetaSession(input), pattern)
  assert.equal(JSON.stringify(input), before)
}

test('M4 complete week has causal plan/closure, paired repair, private summary and no input mutation', () => {
  const input = sample()
  const before = JSON.stringify(input)
  const summary = buildBetaSessionSummary(input)
  assert.equal(summary.supaPlanningDurationSeconds, 240)
  assert.equal(summary.repairCount, 1)
  assert.equal(summary.medianRepairDurationSeconds, 180)
  assert.equal(summary.repairManualEdits, 2)
  assert.equal(summary.publicClaimEligible, false)
  assert.equal(summary.participantKeyIncluded, false)
  assert.equal('participantKey' in summary, false)
  assert.equal(JSON.stringify(input), before)
})

test('M4 omitted repairs have neutral metrics', () => {
  const input = sample()
  input.events = input.events.filter((event) => !event.type.startsWith('repair_'))
  const summary = buildBetaSessionSummary(input)
  assert.equal(summary.repairCount, 0)
  assert.equal(summary.medianRepairDurationSeconds, null)
  assert.equal(summary.repairManualEdits, 0)
})

test('M4 abandoned/unknown weeks preserve legitimately partial starts without inventing completion', () => {
  for (const outcome of ['abandoned', 'unknown']) {
    const input = sample()
    input.sessionOutcome = outcome
    input.events = input.events.filter((event) => event.type !== 'repair_completed' && event.type !== 'plan_completed' && event.type !== 'beta_week_closed')
    const summary = buildBetaSessionSummary(input)
    assert.equal(summary.repairCount, 0)
    assert.equal(summary.supaPlanningDurationSeconds, null)
    assert.equal(summary.returnIntentRating, null)
    assert.equal(summary.publicClaimEligible, false)
  }
})

test('M4 two legitimately completed repairs of the same kind count as two', () => {
  const input = sample()
  input.events.splice(-1, 0,
    { type: 'repair_started', timestamp: '2026-10-11T12:14:00Z', repair_kind: 'skip-meal' },
    { type: 'repair_completed', timestamp: '2026-10-11T12:16:00Z', repair_kind: 'skip-meal', duration_seconds: 60, manual_edits: 1 },
  )
  const summary = buildBetaSessionSummary(input)
  assert.equal(summary.repairCount, 2)
  assert.equal(summary.medianRepairDurationSeconds, 120)
  assert.equal(summary.repairManualEdits, 3)
})

test('M4 interleaved distinct repair kinds match independent starts', () => {
  const input = sample()
  input.events.splice(4, 0, { type: 'repair_started', timestamp: '2026-10-11T12:11:00Z', repair_kind: 'swap-meal' })
  input.events.splice(-1, 0, { type: 'repair_completed', timestamp: '2026-10-11T12:17:00Z', repair_kind: 'swap-meal', duration_seconds: 90, manual_edits: 1 })
  const summary = buildBetaSessionSummary(input)
  assert.equal(summary.repairCount, 2)
  assert.equal(summary.medianRepairDurationSeconds, 135)
})

test('M4 rejects completed plan without start', () => invalid((input) => {
  input.events = input.events.filter((event) => event.type !== 'plan_started')
  return input
}, /plan_started/))

test('M4 rejects plan completion earlier than its start', () => invalid((input) => mutate(input, 'plan_started', (event) => {
  event.timestamp = '2026-10-10T12:06:00Z'
}), /plan_started.*plan_completed/))

test('M4 rejects close before plan completion', () => invalid((input) => mutate(input, 'beta_week_closed', (event) => {
  event.timestamp = '2026-10-10T12:02:00Z'
}), /plan_started.*plan_completed/))

test('M4 rejects activity after week closes even when outer end is later', () => invalid((input) => {
  input.events.push({ type: 'meal_outcome_recorded', timestamp: '2026-10-17T19:30:00Z', meal_slot: 'test-dinner', outcome: 'followed' })
  return input
}, /activity at or after/))

test('M4 rejects duplicate week closures', () => invalid((input) => {
  input.events.push({ type: 'beta_week_closed', timestamp: '2026-10-17T19:15:00Z', return_intent_1_to_5: 4, interview_complete: false })
  return input
}, /exactly one beta_week_closed/))

test('M4 rejects repair completion without prior matching start', () => invalid((input) => {
  input.events = input.events.filter((event) => event.type !== 'repair_started')
  return input
}, /repair_completed requires/))

test('M4 rejects repair completion occurring before start', () => invalid((input) => mutate(input, 'repair_completed', (event) => {
  event.timestamp = '2026-10-11T12:09:00Z'
}), /repair_completed requires/))

test('M4 rejects completion with mismatched repair kind', () => invalid((input) => mutate(input, 'repair_completed', (event) => {
  event.repair_kind = 'swap-meal'
}), /repair_completed requires/))

test('M4 rejects double completion for a single repair start', () => invalid((input) => {
  input.events.splice(-1, 0, { type: 'repair_completed', timestamp: '2026-10-11T12:14:00Z', repair_kind: 'skip-meal', duration_seconds: 60, manual_edits: 1 })
  return input
}, /repair_completed requires/))

for (const [label, change] of [
  ['missing plan start', (input) => { input.events = input.events.filter((event) => event.type !== 'plan_started') }],
  ['orphan repair completion', (input) => { input.events = input.events.filter((event) => event.type !== 'repair_started') }],
]) {
  test(`M4 real CLI refuses ${label} with no artifact, stdout or input change`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'supa-m4-product-'))
    try {
      const input = sample()
      change(input)
      const raw = JSON.stringify(input)
      const source = join(dir, 'evidence.json')
      const target = join(dir, 'report.json')
      await writeFile(source, raw)
      const run = spawnSync(process.execPath, ['scripts/m4-validate-beta-session.mjs', source, '--output', target], { cwd: process.cwd(), encoding: 'utf8' })
      assert.equal(run.status, 1)
      assert.equal(run.stdout, '')
      assert.doesNotMatch(run.stderr, /opaque-fixture-pseudo|invented research cohort/)
      await assert.rejects(readFile(target, 'utf8'), /ENOENT/)
      assert.equal(await readFile(source, 'utf8'), raw)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}
