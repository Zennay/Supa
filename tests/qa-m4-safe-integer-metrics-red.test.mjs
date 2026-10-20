import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildBetaSessionSummary,
  validateBetaSession,
} from '../scripts/m4-validate-beta-session.mjs'

// Fictional, local-only M4 protocol objects. M3 remains OPEN; these are not
// participant sessions, retailer observations, beta eligibility or savings.
const T0 = '2026-01-01T10:00:00.000Z'
const T1 = '2026-01-01T11:00:00.000Z'

function fakeSession(extraEvents = []) {
  return {
    schemaVersion: 1,
    sessionType: 'm4-private-beta-session',
    sessionId: 'fictional-numeric-boundary',
    participantKey: 'synthetic-only',
    population: 'fictional protocol fixture',
    sessionOutcome: 'abandoned',
    consent: { researchConsent: true, allowsAnonymizedQuotes: false },
    // Satisfies the validator input schema ONLY; does not assert real M3 closure.
    m3Gate: { status: 'closed', evidenceRef: 'synthetic-fixture-not-field-evidence' },
    startedAt: T0,
    endedAt: T1,
    events: [
      {
        type: 'beta_session_started',
        timestamp: T0,
        participant_id: 'synthetic-only',
        study_week_id: 'fake-week',
      },
      ...extraEvents,
    ],
  }
}

function baseline(durationSeconds, explicitDecisions = 2, manualEdits = 1) {
  return {
    type: 'baseline_planning_completed',
    timestamp: T1,
    duration_seconds: durationSeconds,
    explicit_meal_decisions: explicitDecisions,
    manual_edits: manualEdits,
    effort_rating: 3,
  }
}

function repair(durationSeconds, manualEdits) {
  return {
    type: 'repair_completed',
    timestamp: T1,
    repair_kind: 'fictional-swap',
    duration_seconds: durationSeconds,
    manual_edits: manualEdits,
  }
}

test('M4 control: ordinary integer counts are exact and summary stays privacy-safe', () => {
  const summary = buildBetaSessionSummary(fakeSession([
    baseline(1200),
    repair(9, 2),
    repair(11, 3),
  ]))
  assert.equal(summary.baselinePlanningDurationSeconds, 1200)
  assert.equal(summary.repairManualEdits, 5)
  assert.equal(summary.medianRepairDurationSeconds, 10)
  assert.equal(summary.sessionOutcome, 'abandoned')
  assert.equal(summary.publicClaimEligible, false)
  assert.equal(summary.participantKeyIncluded, false)
  assert.equal('participantKey' in summary, false)
})

test('M4 control: largest exactly representable positive count is accepted', () => {
  const input = fakeSession([baseline(Number.MAX_SAFE_INTEGER)])
  assert.doesNotThrow(() => validateBetaSession(input))
  assert.equal(buildBetaSessionSummary(input).baselinePlanningDurationSeconds, Number.MAX_SAFE_INTEGER)
})

test('M4 expected RED: reject unsafe duration_seconds before reporting imprecise timing', () => {
  assert.throws(
    () => validateBetaSession(fakeSession([baseline(Number.MAX_SAFE_INTEGER + 1)])),
    /safe integer|duration_seconds|out of range/i,
  )
})

test('M4 expected RED: reject unsafe decision and manual-edit event counts', () => {
  assert.throws(
    () => validateBetaSession(fakeSession([baseline(60, Number.MAX_SAFE_INTEGER + 1)])),
    /safe integer|explicit_meal_decisions|out of range/i,
  )
  assert.throws(
    () => validateBetaSession(fakeSession([repair(10, Number.MAX_SAFE_INTEGER + 1)])),
    /safe integer|manual_edits|out of range/i,
  )
})

test('M4 expected RED: reject unsafe budget_cents rather than preserve rounded money', () => {
  const input = fakeSession([{
    type: 'plan_started',
    timestamp: T1,
    budget_cents: Number.MAX_SAFE_INTEGER + 1,
    planned_days_count: 3,
  }])
  assert.throws(() => validateBetaSession(input), /safe integer|budget_cents|out of range/i)
})

test('M4 expected RED: reject aggregate repair edit counts exceeding safe integer range', () => {
  // Both constituent events are individually exact and legitimate integers.
  // Their sum is not safe to represent as an integer metric in a JSON report.
  const input = fakeSession([repair(10, Number.MAX_SAFE_INTEGER), repair(12, 1)])
  assert.throws(
    () => buildBetaSessionSummary(input),
    /safe integer|repairManualEdits|out of range/i,
  )
})

test('M4 CLI control: safe JSON integer yields private-abstaining summary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supa-m4-integer-'))
  try {
    const path = join(dir, 'fictional-session.json')
    writeFileSync(path, JSON.stringify(fakeSession([baseline(29)])))
    const cli = fileURLToPath(new URL('../scripts/m4-validate-beta-session.mjs', import.meta.url))
    const result = spawnSync(process.execPath, [cli, path], { encoding: 'utf8', timeout: 15_000 })
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.baselinePlanningDurationSeconds, 29)
    assert.equal(report.publicClaimEligible, false)
    assert.equal('participantKey' in report, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('M4 CLI expected RED: reject an unsafe raw JSON integer before it rounds', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supa-m4-integer-'))
  try {
    const path = join(dir, 'fictional-unsafe-session.json')
    let json = JSON.stringify(fakeSession([baseline(29)]))
    // This token cannot be faithfully represented as a JavaScript Number.
    // Insert the raw JSON integer without first rounding it in JS.
    assert.ok(json.includes('"duration_seconds":29'))
    json = json.replace('"duration_seconds":29', '"duration_seconds":9007199254740993')
    writeFileSync(path, json)
    const cli = fileURLToPath(new URL('../scripts/m4-validate-beta-session.mjs', import.meta.url))
    const result = spawnSync(process.execPath, [cli, path], { encoding: 'utf8', timeout: 15_000 })
    assert.notEqual(result.status, 0, 'unsafe raw JSON integer must fail closed')
    assert.equal(result.stdout, '', 'rejected input must not publish summary JSON')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
