import assert from 'node:assert/strict'
import test from 'node:test'
import { m2DefaultActiveDays, m2InitialPlan } from '../src/data/m2Fixture.ts'
import { m3FieldSheetMatchesPlannerWeek } from '../src/features/observation/m3PlannerMeasurementWeek.ts'

const originalMeals = structuredClone(m2InitialPlan)
const selectedDays = [...m2DefaultActiveDays]

test('M3 presentation: own dense and frozen canonical meals match regardless of ordering', () => {
  assert.equal(m3FieldSheetMatchesPlannerWeek(originalMeals, selectedDays), true)
  assert.equal(m3FieldSheetMatchesPlannerWeek(
    Object.freeze(structuredClone(originalMeals).reverse().map(row => Object.freeze(row))),
    Object.freeze([...selectedDays].reverse()),
  ), true)
  assert.deepEqual(m2InitialPlan, originalMeals)
})

test('M3 presentation: ordinary changed and duplicate meals still expose mismatch', () => {
  const changed = structuredClone(originalMeals)
  changed[0].recipeId = 'not-the-study-recipe'
  assert.equal(m3FieldSheetMatchesPlannerWeek(changed, selectedDays), false)
  const duplicate = structuredClone(originalMeals)
  duplicate[0].day = duplicate[1].day
  assert.equal(m3FieldSheetMatchesPlannerWeek(duplicate, selectedDays), false)
})

for (const field of ['day', 'recipeId']) {
  for (const position of [0, 1, 2, 3]) {
    test(`M3 presentation: inherited ${field} at meal slot ${position} never matches study`, () => {
      const meals = structuredClone(originalMeals)
      const row = meals[position]
      const { [field]: value, ...otherFields } = row
      meals[position] = Object.assign(Object.create({ [field]: value }), otherFields)
      assert.equal(meals[position][field], value, 'a normal read would wrongly appear canonical')
      assert.equal(m3FieldSheetMatchesPlannerWeek(meals, selectedDays), false)
    })
    test(`M3 presentation: accessor ${field} at meal slot ${position} is rejected without invoking it`, () => {
      const meals = structuredClone(originalMeals)
      let getterCalls = 0
      Object.defineProperty(meals[position], field, {
        configurable: true,
        get() {
          getterCalls++
          return originalMeals[position][field]
        },
      })
      assert.equal(m3FieldSheetMatchesPlannerWeek(meals, selectedDays), false)
      assert.equal(getterCalls, 0)
    })
  }
}

test('M3 presentation: sparse or accessor meal array slots are rejected', () => {
  const sparse = structuredClone(originalMeals)
  delete sparse[2]
  assert.equal(m3FieldSheetMatchesPlannerWeek(sparse, selectedDays), false)
  const getterSlot = structuredClone(originalMeals)
  let calls = 0
  Object.defineProperty(getterSlot, '2', {
    configurable: true,
    get() {
      calls++
      return originalMeals[2]
    },
  })
  assert.equal(m3FieldSheetMatchesPlannerWeek(getterSlot, selectedDays), false)
  assert.equal(calls, 0)
})

test('M3 presentation: sparse, inherited or accessor active days still reject the measurement match', () => {
  const sparse = [...selectedDays]
  delete sparse[1]
  assert.equal(m3FieldSheetMatchesPlannerWeek(originalMeals, sparse), false)
  const getterDays = [...selectedDays]
  let calls = 0
  Object.defineProperty(getterDays, '1', {
    configurable: true,
    get() {
      calls++
      return selectedDays[1]
    },
  })
  assert.equal(m3FieldSheetMatchesPlannerWeek(originalMeals, getterDays), false)
  assert.equal(calls, 0)
})
