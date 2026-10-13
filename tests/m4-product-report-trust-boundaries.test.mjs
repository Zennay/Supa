import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  buildBetaSessionSummary, validateBetaSession,
} from '../scripts/m4-validate-beta-session.mjs'

// Closed M3 is FICTIONAL, solely a validator precondition. None of these
// test records are genuine retailer observations or consenting M4 students.
function session() {
  return {
    schemaVersion: 1,
    sessionType: 'm4-private-beta-session',
    sessionId: 'fictional-session-001',
    participantKey: 'opaque-fixture-001',
    population: 'synthetic student cohort',
    sessionOutcome: 'completed',
    consent: { researchConsent: true, allowsAnonymizedQuotes: false },
    m3Gate: { status: 'closed', evidenceRef: 'fictional-only' },
    startedAt: '2026-10-10T10:00:00Z',
    endedAt: '2026-10-17T18:00:00Z',
    events: [
      { type: 'beta_session_started', timestamp: '2026-10-10T10:00:00Z', participant_id: 'opaque-fixture-001', study_week_id: 'synthetic-week' },
      { type: 'baseline_planning_completed', timestamp: '2026-10-10T10:10:00Z', duration_seconds: 600, explicit_meal_decisions: 2, manual_edits: 1, effort_rating: 4 },
      { type: 'plan_started', timestamp: '2026-10-10T10:20:00Z', budget_cents: 5000, planned_days_count: 5 },
      { type: 'plan_completed', timestamp: '2026-10-10T10:30:00Z', duration_seconds: 600, planned_meals_count: 5, explicit_meal_decisions: 2 },
      { type: 'basket_assessment_viewed', timestamp: '2026-10-12T11:00:00Z', outcome: 'unknown', unresolved_line_count: 1 },
      { type: 'repair_started', timestamp: '2026-10-13T10:00:00Z', repair_kind: 'skip-meal' },
      { type: 'repair_completed', timestamp: '2026-10-13T10:10:00Z', repair_kind: 'skip-meal', duration_seconds: 600, manual_edits: 1 },
      { type: 'beta_week_closed', timestamp: '2026-10-17T17:00:00Z', return_intent_1_to_5: 3, interview_complete: false },
    ],
  }
}

function event(study, type) {
  const found = study.events.find((item) => item.type === type)
  assert.ok(found)
  return found
}

test('M4 accepts a safe fictional report with unknown incomplete basket and no direct IDs', () => {
  const input = session()
  const unchanged = JSON.stringify(input)
  const report = buildBetaSessionSummary(input)
  assert.equal(report.basketOutcome, 'unknown')
  assert.equal(report.basketUnresolvedLineCount, 1)
  assert.equal(report.repairManualEdits, 1)
  assert.equal(report.publicClaimEligible, false)
  assert.equal('participantKey' in report, false)
  assert.equal(JSON.stringify(input), unchanged)
})

for (const [label, edit] of [
  ['sessionId', (study) => { study.sessionId = 'fictional.person@example.invalid' }],
  ['population', (study) => { study.population = 'students contact fictional.person@example.invalid' }],
  ['newline population', (study) => { study.population = 'synthetic class\nemail: fictional.person@example.invalid' }],
]) {
  test(`M4 refuses email-like direct identifier in ${label} without echoing or mutating evidence`, () => {
    const input = session()
    edit(input)
    const unchanged = JSON.stringify(input)
    assert.throws(() => buildBetaSessionSummary(input), (error) => {
      assert.match(error.message, /direct email identifier/)
      assert.doesNotMatch(error.message, /fictional\.person@example\.invalid/)
      return true
    })
    assert.equal(JSON.stringify(input), unchanged)
  })
}

test('M4 refuses malformed non-pseudonymous session ID independently of free text', () => {
  const input = session()
  input.sessionId = 'not a path safe pseudonym'
  assert.throws(() => validateBetaSession(input), /pseudonymous path-safe key/)
})

for (const outcome of ['better', 'same', 'worse']) {
  test(`M4 cannot call an unresolved basket ${outcome}`, () => {
    const input = session()
    event(input, 'basket_assessment_viewed').outcome = outcome
    assert.throws(() => buildBetaSessionSummary(input), /outcome must be unknown/)
  })
}
test('M4 accepts a complete fictional basket comparison but never a public claim', () => {
  const input = session()
  const basket = event(input, 'basket_assessment_viewed')
  basket.outcome = 'worse'
  basket.unresolved_line_count = 0
  const report = buildBetaSessionSummary(input)
  assert.equal(report.basketOutcome, 'worse')
  assert.equal(report.publicClaimEligible, false)
})
test('M4 zero unresolved lines may still legitimately have unknown comparison', () => {
  const input = session()
  event(input, 'basket_assessment_viewed').unresolved_line_count = 0
  assert.equal(buildBetaSessionSummary(input).basketOutcome, 'unknown')
})

for (const [label, apply] of [
  ['budget cents', (study) => { event(study, 'plan_started').budget_cents = Number.MAX_SAFE_INTEGER + 1 }],
  ['plan duration', (study) => { event(study, 'plan_completed').duration_seconds = Number.MAX_SAFE_INTEGER + 1 }],
  ['baseline manual edits', (study) => { event(study, 'baseline_planning_completed').manual_edits = Number.MAX_SAFE_INTEGER + 1 }],
  ['repair manual edits', (study) => { event(study, 'repair_completed').manual_edits = Number.MAX_SAFE_INTEGER + 1 }],
  ['planned days', (study) => { event(study, 'plan_started').planned_days_count = Number.MAX_SAFE_INTEGER + 1 }],
]) {
  test(`M4 rejects non-safe integer metric: ${label}`, () => {
    const input = session()
    apply(input)
    assert.throws(() => buildBetaSessionSummary(input), /safe integer/)
  })
}
test('M4 permits one MAX_SAFE_INTEGER repair edit field without rounding', () => {
  const input = session()
  event(input, 'repair_completed').manual_edits = Number.MAX_SAFE_INTEGER
  assert.equal(buildBetaSessionSummary(input).repairManualEdits, Number.MAX_SAFE_INTEGER)
})
test('M4 refuses a rounded-overflow aggregate from individually safe repair edits', () => {
  const input = session()
  event(input, 'repair_completed').manual_edits = Number.MAX_SAFE_INTEGER
  input.events.splice(-1, 0,
    { type: 'repair_started', timestamp: '2026-10-13T10:20:00Z', repair_kind: 'replace-meal' },
    { type: 'repair_completed', timestamp: '2026-10-13T10:30:00Z', repair_kind: 'replace-meal', duration_seconds: 60, manual_edits: 1 },
  )
  assert.throws(() => buildBetaSessionSummary(input), /repairManualEdits total exceeds safe integer range/)
})

for (const [name, edit] of [
  ['identity metadata', (study) => { study.population = 'contact fictional.person@example.invalid' }],
  ['false resolved savings', (study) => { event(study, 'basket_assessment_viewed').outcome = 'better' }],
  ['unsafe repair metric', (study) => { event(study, 'repair_completed').manual_edits = Number.MAX_SAFE_INTEGER + 1 }],
]) {
  test(`M4 real CLI rejects ${name} without private report or source change`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'supa-m4-product-trust-'))
    try {
      const input = session()
      edit(input)
      const raw = JSON.stringify(input)
      const source = join(directory, 'private-input.json')
      const target = join(directory, 'report.json')
      await writeFile(source, raw, { mode: 0o600 })
      const run = spawnSync(process.execPath, [
        'scripts/m4-validate-beta-session.mjs', source, '--output', target,
      ], { cwd: process.cwd(), encoding: 'utf8' })
      assert.equal(run.status, 1)
      assert.equal(run.stdout, '')
      assert.doesNotMatch(run.stderr, /fictional\.person@example\.invalid|opaque-fixture-001/)
      await assert.rejects(readFile(target, 'utf8'), /ENOENT/)
      assert.equal(await readFile(source, 'utf8'), raw)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}
