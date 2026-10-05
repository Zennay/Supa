import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildBetaSessionSummary,
  validateBetaSession,
} from '../scripts/m4-validate-beta-session.mjs'

function validSession() {
  return {
    schemaVersion: 1,
    sessionType: 'm4-private-beta-session',
    sessionId: 'm4-session-001',
    participantKey: 'p-001',
    population: 'uitwonende student',
    consent: {
      researchConsent: true,
      allowsAnonymizedQuotes: false,
    },
    m3Gate: {
      status: 'closed',
      evidenceRef: 'PWQ-14/AUD-003 evidence record',
    },
    startedAt: '2026-10-10T10:00:00.000Z',
    endedAt: '2026-10-10T12:00:00.000Z',
    sessionOutcome: 'completed',
    observedBasketOutcome: 'unknown',
    plan: {
      plannedMealCount: 5,
      followedMealCount: 4,
    },
    events: [
      { type: 'meal-decision', at: '2026-10-10T10:05:00.000Z', count: 3 },
      { type: 'list-edit', at: '2026-10-10T10:08:00.000Z', count: 2 },
      { type: 'plan-completed', at: '2026-10-10T10:12:30.000Z' },
      { type: 'plan-repair', at: '2026-10-10T11:00:00.000Z' },
      { type: 'leftover-waste', at: '2026-10-10T11:30:00.000Z', count: 2 },
    ],
    selfReport: {
      planningEffortBefore: 6,
      planningEffortAfter: 3,
      reuseAcceptability: 5,
      explanationTrust: 4,
      wouldUseAgain: true,
    },
    qualitative: {
      biggestFriction: 'Changing one meal still required checking the list.',
    },
  }
}

test('M4 beta validator derives privacy-safe research metrics', () => {
  const summary = buildBetaSessionSummary(validSession())

  assert.equal(summary.timeToFirstCompletePlanSeconds, 750)
  assert.equal(summary.manualListIngredientEdits, 2)
  assert.equal(summary.explicitMealDecisions, 3)
  assert.equal(summary.planRepairCount, 1)
  assert.equal(summary.leftoverWasteEventCount, 2)
  assert.equal(summary.plannedMealAdherence, 0.8)
  assert.equal(summary.participantKeyIncluded, false)
  assert.equal(summary.publicClaimEligible, false)
  assert.equal('participantKey' in summary, false)
})

test('M4 beta validator fails closed while the M3 gate is not closed', () => {
  const session = validSession()
  session.m3Gate.status = 'open'

  assert.throws(
    () => validateBetaSession(session),
    /m3Gate\.status must be closed before M4 beta data is accepted/,
  )
})

test('completed M4 sessions require an observed plan completion event', () => {
  const session = validSession()
  session.events = session.events.filter((event) => event.type !== 'plan-completed')

  assert.throws(
    () => validateBetaSession(session),
    /completed sessions require a plan-completed event/,
  )
})

test('negative and unknown beta outcomes remain valid evidence states', () => {
  for (const outcome of ['better', 'same', 'worse', 'unknown']) {
    const session = validSession()
    session.observedBasketOutcome = outcome
    assert.equal(buildBetaSessionSummary(session).observedBasketOutcome, outcome)
  }
})

test('abandoned sessions can retain evidence without fabricating completion time', () => {
  const session = validSession()
  session.sessionOutcome = 'abandoned'
  session.events = session.events.filter((event) => event.type !== 'plan-completed')

  const summary = buildBetaSessionSummary(session)
  assert.equal(summary.timeToFirstCompletePlanSeconds, null)
  assert.equal(summary.sessionOutcome, 'abandoned')
})
