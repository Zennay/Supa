import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  buildBetaSessionSummary,
  validateBetaSession,
} from '../scripts/m4-validate-beta-session.mjs'

const CLI = fileURLToPath(new URL('../scripts/m4-validate-beta-session.mjs', import.meta.url))

// Entirely fictional, never a participant record. The gate is closed *only*
// in the synthetic fixture; actual M3 #78 remains open and M4 ineligible.
function session() {
  return {
    schemaVersion: 1,
    sessionType: 'm4-private-beta-session',
    sessionId: 'synthetic-repair-session',
    participantKey: 'synthetic-pseudonym',
    population: 'synthetic-cohort',
    sessionOutcome: 'completed',
    consent: { researchConsent: true, allowsAnonymizedQuotes: false },
    m3Gate: { status: 'closed', evidenceRef: 'synthetic-gate-not-real-evidence' },
    startedAt: '2026-10-10T12:00:00.000Z',
    endedAt: '2026-10-10T13:00:00.000Z',
    events: [
      {
        type: 'beta_session_started',
        timestamp: '2026-10-10T12:00:00.000Z',
        participant_id: 'synthetic-pseudonym',
        study_week_id: 'synthetic-week',
      },
      {
        type: 'plan_started',
        timestamp: '2026-10-10T12:01:00.000Z',
        budget_cents: 4500,
        planned_days_count: 5,
      },
      {
        type: 'plan_completed',
        timestamp: '2026-10-10T12:05:00.000Z',
        duration_seconds: 240,
        planned_meals_count: 5,
        explicit_meal_decisions: 3,
      },
      {
        type: 'repair_started',
        timestamp: '2026-10-10T12:10:00.000Z',
        repair_kind: 'skip-meal',
      },
      {
        type: 'repair_completed',
        timestamp: '2026-10-10T12:13:00.000Z',
        repair_kind: 'skip-meal',
        duration_seconds: 180,
        manual_edits: 2,
      },
      {
        type: 'beta_week_closed',
        timestamp: '2026-10-10T12:30:00.000Z',
        return_intent_1_to_5: 3,
        interview_complete: false,
      },
    ],
  }
}

function removeType(input, type) {
  input.events = input.events.filter((event) => event.type !== type)
  return input
}

function event(input, type) {
  return input.events.find((item) => item.type === type)
}

test('M4 repair positive: causal paired event preserves exactly one measured repair', () => {
  const input = session()
  const before = JSON.stringify(input)
  const summary = buildBetaSessionSummary(input)
  assert.equal(summary.repairCount, 1)
  assert.equal(summary.medianRepairDurationSeconds, 180)
  assert.equal(summary.repairManualEdits, 2)
  assert.equal(summary.publicClaimEligible, false)
  assert.equal(summary.participantKeyIncluded, false)
  assert.equal(Object.hasOwn(summary, 'participantKey'), false)
  assert.equal(JSON.stringify(input), before, 'source evidence must not be mutated')
})

test('M4 repair positive: without repair events, no repair effort is invented', () => {
  const input = removeType(removeType(session(), 'repair_started'), 'repair_completed')
  const summary = buildBetaSessionSummary(input)
  assert.equal(summary.repairCount, 0)
  assert.equal(summary.medianRepairDurationSeconds, null)
  assert.equal(summary.repairManualEdits, 0)
})

test('M4 repair positive: abandoned partial session may retain an open repair start', () => {
  const input = removeType(removeType(session(), 'beta_week_closed'), 'repair_completed')
  input.sessionOutcome = 'abandoned'
  const summary = buildBetaSessionSummary(input)
  assert.equal(summary.sessionOutcome, 'abandoned')
  assert.equal(summary.repairCount, 0)
  assert.equal(summary.medianRepairDurationSeconds, null)
  assert.equal(summary.returnIntentRating, null)
  assert.equal(summary.publicClaimEligible, false)
})

const invalidRepairs = [
  [
    'orphan repair completion without any corresponding start',
    (input) => removeType(input, 'repair_started'),
  ],
  [
    'repair completion occurs before its start',
    (input) => {
      event(input, 'repair_completed').timestamp = '2026-10-10T12:09:00.000Z'
      return input
    },
  ],
  [
    'repair kind does not match the only preceding start',
    (input) => {
      event(input, 'repair_completed').repair_kind = 'replace-meal'
      return input
    },
  ],
  [
    'one start incorrectly authorizes two repair completions',
    (input) => {
      input.events.splice(-1, 0, {
        type: 'repair_completed',
        timestamp: '2026-10-10T12:14:00.000Z',
        repair_kind: 'skip-meal',
        duration_seconds: 60,
        manual_edits: 1,
      })
      return input
    },
  ],
]

for (const [title, mutate] of invalidRepairs) {
  test('M4 repair expected RED: reject ' + title, () => {
    const input = mutate(session())
    const immutable = JSON.stringify(input)
    assert.throws(
      () => validateBetaSession(input),
      /repair|start|complete|pair|order|sequence|caus/i,
      'a repair completion needs its own preceding unmatched start of the same kind',
    )
    assert.equal(JSON.stringify(input), immutable, 'validation must never rewrite evidence')
  })
}

test('M4 repair expected RED: real CLI refuses orphan completion before writing a report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supa-m4-repair-qa-'))
  const source = join(dir, 'private-session.json')
  const target = join(dir, 'private-report.json')
  const input = removeType(session(), 'repair_started')
  const bytes = Buffer.from(JSON.stringify(input) + '\n', 'utf8')
  try {
    writeFileSync(source, bytes, { mode: 0o600 })
    chmodSync(source, 0o600)
    const result = spawnSync(process.execPath, [CLI, source, '--output', target], {
      encoding: 'utf8',
      timeout: 15000,
    })
    assert.equal(result.error, undefined, 'CLI should launch and return a status')
    assert.notEqual(result.status, 0, 'invalid repair chronology must be rejected')
    assert.equal(existsSync(target), false, 'no private report may be published on validation failure')
    assert.equal(result.stdout, '', 'invalid CLI must not emit report JSON')
    assert.doesNotMatch(result.stderr, /synthetic-pseudonym|synthetic-cohort|synthetic-repair-session/)
    assert.deepEqual(readFileSync(source), bytes, 'source bytes remain unchanged')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})


test('M4 repair positive: consecutive same-kind repairs represent two real starts', () => {
  const input = session()
  input.events.splice(-1, 0,
    {
      type: 'repair_started',
      timestamp: '2026-10-10T12:15:00.000Z',
      repair_kind: 'skip-meal',
    },
    {
      type: 'repair_completed',
      timestamp: '2026-10-10T12:18:00.000Z',
      repair_kind: 'skip-meal',
      duration_seconds: 60,
      manual_edits: 1,
    },
  )
  const summary = buildBetaSessionSummary(input)
  assert.equal(summary.repairCount, 2)
  assert.equal(summary.medianRepairDurationSeconds, 120)
  assert.equal(summary.repairManualEdits, 3)
  assert.equal(summary.publicClaimEligible, false)
})

test('M4 repair positive: interleaved kinds preserve two independently started repairs', () => {
  const input = session()
  input.events.splice(4, 0, {
    type: 'repair_started',
    timestamp: '2026-10-10T12:11:00.000Z',
    repair_kind: 'swap-meal',
  })
  input.events.splice(-1, 0, {
    type: 'repair_completed',
    timestamp: '2026-10-10T12:17:00.000Z',
    repair_kind: 'swap-meal',
    duration_seconds: 90,
    manual_edits: 1,
  })
  const summary = buildBetaSessionSummary(input)
  assert.equal(summary.repairCount, 2)
  assert.equal(summary.medianRepairDurationSeconds, 135)
  assert.equal(summary.repairManualEdits, 3)
  assert.equal(summary.publicClaimEligible, false)
})


test('M4 repair positive: unknown session retains incomplete repair without completion metrics', () => {
  const input = removeType(removeType(removeType(session(), 'plan_completed'), 'beta_week_closed'), 'repair_completed')
  input.sessionOutcome = 'unknown'
  const summary = buildBetaSessionSummary(input)
  assert.equal(summary.sessionOutcome, 'unknown')
  assert.equal(summary.supaPlanningDurationSeconds, null)
  assert.equal(summary.repairCount, 0)
  assert.equal(summary.medianRepairDurationSeconds, null)
  assert.equal(summary.repairManualEdits, 0)
  assert.equal(summary.returnIntentRating, null)
  assert.equal(summary.publicClaimEligible, false)
})

test('M4 repair positive: real CLI writes a valid repair summary without exposing participant key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supa-m4-repair-positive-qa-'))
  const source = join(dir, 'private-session.json')
  const target = join(dir, 'private-report.json')
  const bytes = Buffer.from(JSON.stringify(session()) + '\n', 'utf8')
  try {
    writeFileSync(source, bytes, { mode: 0o600 })
    chmodSync(source, 0o600)
    const result = spawnSync(process.execPath, [CLI, source, '--output', target], {
      encoding: 'utf8',
      timeout: 15000,
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, 'valid causal repair session should still pass')
    assert.equal(result.stdout, '', 'file output mode must not duplicate the report to stdout')
    assert.equal(existsSync(target), true, 'valid session must produce a summary')
    const reportText = readFileSync(target, 'utf8')
    const report = JSON.parse(reportText)
    assert.equal(report.repairCount, 1)
    assert.equal(report.medianRepairDurationSeconds, 180)
    assert.equal(report.repairManualEdits, 2)
    assert.equal(report.publicClaimEligible, false)
    assert.equal(report.participantKeyIncluded, false)
    assert.equal(Object.hasOwn(report, 'participantKey'), false)
    assert.doesNotMatch(reportText, /synthetic-pseudonym/)
    assert.deepEqual(readFileSync(source), bytes, 'real CLI may not mutate private source bytes')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
