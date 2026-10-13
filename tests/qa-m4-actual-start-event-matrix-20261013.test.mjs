import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildBetaSessionSummary, validateBetaSession } from '../scripts/m4-validate-beta-session.mjs'

// All records below are disposable fiction. A closed M3 gate is ONLY a
// synthetic parser fixture; it is not field proof or M4 participant approval.
const OUTER_START = '2026-10-10T09:00:00Z'
const ACTUAL_START = '2026-10-10T10:00:00Z'
const EARLY = '2026-10-10T09:30:00Z'
const LATER = '2026-10-10T10:20:00Z'

function fixture(outcome = 'unknown') {
  return {
    schemaVersion: 1,
    sessionType: 'm4-private-beta-session',
    sessionId: 'fictional-m4-matrix',
    participantKey: 'fictional-pseudonym',
    population: 'fictional cohort',
    sessionOutcome: outcome,
    consent: { researchConsent: true, allowsAnonymizedQuotes: false },
    m3Gate: { status: 'closed', evidenceRef: 'fictional-test-gate-only' },
    startedAt: OUTER_START,
    endedAt: '2026-10-18T20:00:00Z',
    events: [{
      type: 'beta_session_started',
      timestamp: ACTUAL_START,
      participant_id: 'fictional-pseudonym',
      study_week_id: 'fictional-week',
    }],
  }
}

// One genuinely valid payload per public M4 event kind, with no real names,
// retailer prices, participant identities, recruiting or external requests.
const EVENT_CASES = [
  ['baseline_planning_completed', { duration_seconds: 150, explicit_meal_decisions: 2, manual_edits: 1, effort_rating: 3 }],
  ['plan_started', { budget_cents: 4500, planned_days_count: 5 }],
  ['meal_decision_recorded', { meal_slot: 'monday-lunch', decision_kind: 'accepted' }],
  ['plan_completed', { duration_seconds: 160, planned_meals_count: 5, explicit_meal_decisions: 2 }],
  ['list_edit_recorded', { edit_kind: 'replace', item_key: 'fictional-item' }],
  ['reuse_explanation_viewed', { ingredient_key: 'fictional-ingredient', related_meal_count: 2 }],
  ['schedule_change_recorded', { change_kind: 'move', affected_slot: 'tuesday-dinner' }],
  ['repair_started', { repair_kind: 'fictional-adjustment' }],
  ['repair_completed', { repair_kind: 'fictional-adjustment', duration_seconds: 20, manual_edits: 1 }],
  ['meal_outcome_recorded', { meal_slot: 'wednesday-dinner', outcome: 'followed' }],
  ['leftover_event_recorded', { ingredient_key: 'fictional-rice', outcome: 'remaining' }],
  ['basket_assessment_viewed', { outcome: 'unknown', unresolved_line_count: 1 }],
  ['basket_recommendation_decided', { followed: false, reason: 'fictional uncertainty' }],
  ['trust_rating_submitted', { rating_1_to_5: 3, uncertainty_understood: true }],
  ['weekly_effort_submitted', { rating_1_to_5: 4 }],
  ['beta_week_closed', { return_intent_1_to_5: 3, interview_complete: false }],
]

function eventOf(type, fields, timestamp = LATER) {
  return { type, timestamp, ...fields }
}

function addPrerequisite(session, type) {
  if (type === 'repair_completed') {
    session.events.push(eventOf('repair_started', { repair_kind: 'fictional-adjustment' }, '2026-10-10T10:05:00Z'))
  }
}

for (const [type, fields] of EVENT_CASES) {
  test('M4 refuses pre-actual-start ' + type + ' despite permissive outer startedAt', () => {
    const input = fixture()
    addPrerequisite(input, type)
    input.events.push(eventOf(type, fields, EARLY))
    const before = JSON.stringify(input)
    assert.throws(
      () => buildBetaSessionSummary(input),
      /M4 events must not precede beta_session_started/,
    )
    assert.equal(JSON.stringify(input), before, 'validation must not mutate private input')
  })

  // A beta_week_closed event on a partial/unknown session is intentionally
  // not declared a positive control: only its PRE-start rejection is tested.
  if (type !== 'beta_week_closed') {
    test('M4 accepts post-actual-start fictional ' + type, () => {
      const input = fixture('abandoned')
      addPrerequisite(input, type)
      input.events.push(eventOf(type, fields))
      const before = JSON.stringify(input)
      assert.doesNotThrow(() => validateBetaSession(input))
      const report = buildBetaSessionSummary(input)
      assert.equal(report.publicClaimEligible, false)
      assert.equal(report.sessionOutcome, 'abandoned')
      assert.equal(report.participantKeyIncluded, false)
      assert.equal('participantKey' in report, false)
      assert.equal(JSON.stringify(input), before)
    })
  }
}

test('M4 allows meaningful events at exact actual start (inclusive boundary)', () => {
  const input = fixture('unknown')
  input.events.push(eventOf('weekly_effort_submitted', { rating_1_to_5: 4 }, ACTUAL_START))
  assert.equal(buildBetaSessionSummary(input).weeklyEffortRating, 4)
})

test('M4 respects offset-equivalent timestamps, not lexical string order', () => {
  const input = fixture('unknown')
  // 12:00+02:00 equals actual 10:00Z, while 11:59+02:00 precedes it.
  input.events.push(eventOf('trust_rating_submitted', { rating_1_to_5: 2, uncertainty_understood: true }, '2026-10-10T12:00:00+02:00'))
  assert.equal(buildBetaSessionSummary(input).explanationTrustRating, 2)
  input.events.at(-1).timestamp = '2026-10-10T11:59:00+02:00'
  assert.throws(() => validateBetaSession(input), /M4 events must not precede beta_session_started/)
})

test('M4 accepts out-of-order arrays with causal chronological evidence', () => {
  const input = fixture('abandoned')
  input.events.unshift(eventOf('plan_completed', { duration_seconds: 100, planned_meals_count: 3, explicit_meal_decisions: 1 }, '2026-10-10T10:10:00Z'))
  input.events.push(eventOf('plan_started', { budget_cents: 1500, planned_days_count: 3 }, '2026-10-10T10:05:00Z'))
  assert.equal(buildBetaSessionSummary(input).supaPlanningDurationSeconds, 100)
})

test('M4 unknown empty partial session cannot invent effort, adherence or eligibility', () => {
  const report = buildBetaSessionSummary(fixture())
  assert.equal(report.repairCount, 0)
  assert.equal(report.supaPlanningDurationSeconds, null)
  assert.equal(report.planAdherence, null)
  assert.equal(report.returnIntentRating, null)
  assert.equal(report.publicClaimEligible, false)
})

async function inTemporaryEvidence(callback) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-m4-start-matrix-'))
  try {
    const source = join(dir, 'input.json')
    const target = join(dir, 'summary.json')
    return await callback(source, target)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

for (const type of ['weekly_effort_submitted', 'meal_outcome_recorded', 'repair_started']) {
  test('private M4 CLI rejects pre-start ' + type + ' without report or identity leak', async () => {
    await inTemporaryEvidence(async (source, target) => {
      const [kind, fields] = EVENT_CASES.find(([candidate]) => candidate === type)
      const input = fixture('unknown')
      input.events.push(eventOf(kind, fields, EARLY))
      const original = JSON.stringify(input)
      await writeFile(source, original, { mode: 0o600 })
      const run = spawnSync(process.execPath,
        ['scripts/m4-validate-beta-session.mjs', source, '--output', target],
        { encoding: 'utf8', cwd: process.cwd() })
      assert.equal(run.status, 1)
      assert.equal(run.stdout, '')
      assert.match(run.stderr, /M4 events must not precede beta_session_started/)
      assert.doesNotMatch(run.stderr, /fictional-pseudonym|fictional cohort|fictional-m4-matrix/)
      await assert.rejects(readFile(target, 'utf8'), /ENOENT/)
      assert.equal(await readFile(source, 'utf8'), original)
    })
  })
}

test('private M4 CLI publishes only one mode-0600 pseudonymous report for a valid partial session', async () => {
  await inTemporaryEvidence(async (source, target) => {
    const input = fixture('unknown')
    input.events.push(eventOf('weekly_effort_submitted', { rating_1_to_5: 4 }, ACTUAL_START))
    const original = JSON.stringify(input)
    await writeFile(source, original, { mode: 0o600 })
    const run = spawnSync(process.execPath,
      ['scripts/m4-validate-beta-session.mjs', source, '--output', target],
      { encoding: 'utf8', cwd: process.cwd() })
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.stdout, '')
    assert.equal(run.stderr, '')
    const published = await readFile(target, 'utf8')
    const report = JSON.parse(published)
    assert.equal(report.weeklyEffortRating, 4)
    assert.equal(report.publicClaimEligible, false)
    assert.equal('participantKey' in report, false)
    assert.doesNotMatch(published, /fictional-pseudonym|fictional-test-gate-only/)
    assert.equal((await stat(target)).mode & 0o777, 0o600)
    assert.equal(await readFile(source, 'utf8'), original)
  })
})
