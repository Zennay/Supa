import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildBetaSessionSummary, validateBetaSession } from '../scripts/m4-validate-beta-session.mjs'

// Entirely fictional source evidence. A "closed" M3 gate here is only the
// necessary test precondition, never real PLUS/DekaMarkt proof or M4 eligibility.
function study(outcomes = [['monday-dinner', 'followed'], ['tuesday-dinner', 'skipped']], sessionOutcome = 'completed') {
  const events = [
    { type: 'beta_session_started', timestamp: '2026-10-10T09:00:00Z', participant_id: 'fictional-pseudo', study_week_id: 'fake-week' },
    { type: 'plan_started', timestamp: '2026-10-10T09:10:00Z', budget_cents: 5000, planned_days_count: 5 },
    { type: 'plan_completed', timestamp: '2026-10-10T10:00:00Z', duration_seconds: 600, planned_meals_count: 5, explicit_meal_decisions: 2 },
    ...outcomes.map(([meal_slot, outcome], index) => ({
      type: 'meal_outcome_recorded',
      timestamp: new Date(Date.parse('2026-10-12T12:00:00Z') + 60_000 * index).toISOString(),
      meal_slot,
      outcome,
    })),
  ]
  if (sessionOutcome === 'completed') {
    events.push({ type: 'beta_week_closed', timestamp: '2026-10-17T18:00:00Z', return_intent_1_to_5: 4, interview_complete: false })
  }
  return {
    schemaVersion: 1,
    sessionType: 'm4-private-beta-session',
    sessionId: 'fictional-meal-identity-001',
    participantKey: 'fictional-pseudo',
    population: 'synthetic student cohort',
    sessionOutcome,
    consent: { researchConsent: true, allowsAnonymizedQuotes: false },
    m3Gate: { status: 'closed', evidenceRef: 'fake-m3-gate-never-real' },
    startedAt: '2026-10-10T09:00:00Z',
    endedAt: '2026-10-17T19:00:00Z',
    events,
  }
}

function rejectsWithoutMutation(source, error) {
  const before = JSON.stringify(source)
  assert.throws(() => buildBetaSessionSummary(source), error)
  assert.equal(JSON.stringify(source), before, 'validation may not mutate source events')
}

test('M4 keeps per-meal adherence 1/2 with two unique known outcomes and private-only status', () => {
  const data = study()
  const original = JSON.stringify(data)
  const report = buildBetaSessionSummary(data)
  assert.equal(report.planAdherence, 0.5)
  assert.equal(report.publicClaimEligible, false)
  assert.equal(report.participantKeyIncluded, false)
  assert.equal('participantKey' in report, false)
  assert.equal(JSON.stringify(data), original)
})

for (const [title, rows, rate] of [
  ['one followed outcome', [['monday', 'followed']], 1],
  ['one skipped outcome', [['monday', 'skipped']], 0],
  ['no recorded outcomes', [], null],
  ['unknown outcome only', [['monday', 'unknown']], null],
  ['mix of followed and unknown', [['monday', 'followed'], ['tuesday', 'unknown']], 1],
  ['unknown outcome mixed with swapped', [['monday', 'unknown'], ['tuesday', 'swapped']], 0],
]) {
  test(`M4 retains known/unknown adherence semantics: ${title}`, () => {
    const report = buildBetaSessionSummary(study(rows))
    assert.equal(report.planAdherence, rate)
    assert.equal(report.publicClaimEligible, false)
  })
}

for (const state of ['abandoned', 'unknown']) {
  test(`M4 ${state} sessions preserve partial meal evidence and missing outcomes`, () => {
    const data = study([['tuesday', 'unknown']], state)
    const report = buildBetaSessionSummary(data)
    assert.equal(report.sessionOutcome, state)
    assert.equal(report.planAdherence, null)
    assert.equal(report.returnIntentRating, null)
    assert.equal(report.publicClaimEligible, false)
  })
}

for (const [label, rows] of [
  ['same slot repeated twice followed', [['monday', 'followed'], ['monday', 'followed']]],
  ['contradictory followed and skipped', [['monday', 'followed'], ['monday', 'skipped']]],
  ['unknown and later followed', [['monday', 'unknown'], ['monday', 'followed']]],
  ['NFKC equivalent full-width spelling', [['Ａ', 'followed'], ['A', 'skipped']]],
  ['composed/decomposed accented spelling', [['café', 'followed'], ['café', 'skipped']]],
]) {
  test(`M4 fails closed on duplicate meal identity: ${label}`, () => {
    rejectsWithoutMutation(study(rows), /exactly one final outcome/)
  })
}

for (const bad of ['', ' ', ' monday', 'monday ', 'monday\n', '\u0301', '\u00b4', '\uff9e', '\ufe0f', 'a\u202e', 'a\u200b', 'a'.repeat(257)]) {
  test(`M4 rejects non-canonical/invisible/oversized slot: ${JSON.stringify(bad)}`, () => {
    rejectsWithoutMutation(study([[bad, 'followed']]), /M4 meal outcome slot|meal_slot must be a non-empty string/)
  })
}

for (const valid of ['é', 'Café', '🍕\ufe0f', 'A\u20dd', 'Ａ', 'monday-dinner', '1', '♪']) {
  test(`M4 retains perceptible unicode meal-slot identity: ${JSON.stringify(valid)}`, () => {
    const result = buildBetaSessionSummary(study([[valid, 'followed']]))
    assert.equal(result.planAdherence, 1)
  })
}

test('M4 rejects duplicate outcome even if it is at the end of the event batch', () => {
  const data = study([['monday', 'followed'], ['tuesday', 'skipped'], ['monday', 'followed']])
  rejectsWithoutMutation(data, /exactly one final outcome/)
})

test('M4 direct validator rejects duplicate without returning a seemingly valid session', () => {
  const input = study([['monday', 'followed'], ['monday', 'unknown']])
  assert.throws(() => validateBetaSession(input), /exactly one final outcome/)
})

test('M4 actual CLI rejects ambiguous adherence before creating private output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-product-adherence-'))
  try {
    const raw = JSON.stringify(study([['monday', 'followed'], ['monday', 'skipped']]))
    const source = join(dir, 'session.json')
    const target = join(dir, 'report.json')
    await writeFile(source, raw, { mode: 0o600 })
    const run = spawnSync(process.execPath, [
      'scripts/m4-validate-beta-session.mjs', source, '--output', target,
    ], { cwd: process.cwd(), encoding: 'utf8' })
    assert.equal(run.status, 1)
    assert.equal(run.stdout, '')
    assert.match(run.stderr, /exactly one final outcome/)
    assert.doesNotMatch(run.stderr, /fictional-pseudo|synthetic student/)
    await assert.rejects(readFile(target, 'utf8'), /ENOENT/)
    assert.equal(await readFile(source, 'utf8'), raw)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
