import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parsePlannerPreferences,
  serializePlannerPreferences,
} from '../src/domain/plannerPreferences.ts'

const days = ['Ma', 'Di', 'Wo', 'Do']

test('planner preferences fall back when storage is absent or malformed', () => {
  assert.deepEqual(parsePlannerPreferences(null, days), {
    budget: 35,
    activeDays: days,
  })

  assert.deepEqual(parsePlannerPreferences('{not-json', days), {
    budget: 35,
    activeDays: days,
  })
})

test('planner preferences keep valid persisted choices and discard unknown days', () => {
  const state = parsePlannerPreferences(
    JSON.stringify({
      budget: 40,
      activeDays: ['Ma', 'Wo', 'Wo', 'Vr'],
    }),
    days,
  )

  assert.deepEqual(state, {
    budget: 40,
    activeDays: ['Ma', 'Wo'],
  })
})

test('planner preferences recover when every persisted day is stale', () => {
  const state = parsePlannerPreferences(
    JSON.stringify({ budget: 40, activeDays: ['Vr', 'Za'] }),
    days,
  )

  assert.deepEqual(state, {
    budget: 40,
    activeDays: days,
  })
})

test('planner preferences preserve an intentionally empty plan', () => {
  const state = parsePlannerPreferences(
    JSON.stringify({ budget: 30, activeDays: [] }),
    days,
  )

  assert.deepEqual(state, {
    budget: 30,
    activeDays: [],
  })
})

test('planner preferences serialize to a stable JSON payload', () => {
  const state = { budget: 35, activeDays: ['Di', 'Do'] }

  assert.deepEqual(
    parsePlannerPreferences(serializePlannerPreferences(state), days),
    state,
  )
})
