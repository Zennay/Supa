import assert from 'node:assert/strict'
import test from 'node:test'

import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'

test('canonical M2 fixture is deeply immutable at exported mutation boundaries', () => {
  assert.equal(Object.isFrozen(m2Store), true)
  assert.equal(Object.isFrozen(m2Recipes), true)
  assert.equal(Object.isFrozen(m2Recipes[0]), true)
  assert.equal(Object.isFrozen(m2Recipes[0].tags), true)
  assert.equal(Object.isFrozen(m2Recipes[0].ingredients), true)
  assert.equal(Object.isFrozen(m2Recipes[0].ingredients[0]), true)
  assert.equal(Object.isFrozen(m2InitialPlan), true)
  assert.equal(Object.isFrozen(m2InitialPlan[0]), true)
  assert.equal(Object.isFrozen(m2Products), true)
  assert.equal(Object.isFrozen(m2Products[0]), true)
  assert.equal(Object.isFrozen(m2DefaultActiveDays), true)

  assert.throws(() => {
    m2Store.name = 'Mutated store'
  }, TypeError)

  assert.throws(() => {
    m2Recipes[0].title = 'Mutated recipe'
  }, TypeError)

  assert.throws(() => {
    m2Recipes[0].tags.push('mutated')
  }, TypeError)

  assert.throws(() => {
    m2Recipes[0].ingredients[0].amount = 999
  }, TypeError)

  assert.throws(() => {
    m2InitialPlan[0].recipeId = 'mutated'
  }, TypeError)

  assert.throws(() => {
    m2Products[0].priceCents = 1
  }, TypeError)

  assert.throws(() => {
    m2DefaultActiveDays.push('Vr')
  }, TypeError)
})
