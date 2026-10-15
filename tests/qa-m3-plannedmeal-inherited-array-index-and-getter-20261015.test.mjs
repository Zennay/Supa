import assert from 'node:assert/strict'
import test from 'node:test'
import { m2InitialPlan, m2DefaultActiveDays } from '../src/data/m2Fixture.ts'
import { m3FieldSheetMatchesPlannerWeek } from '../src/features/observation/m3PlannerMeasurementWeek.ts'

// Separate QA for *array index identity* in the M3 frozen comparison.
// Distinct from old #3016 tests of day/recipe *inside* a present row.
// Per-run prototypes are local: do not patch Array.prototype/global state.
const meals = structuredClone(m2InitialPlan)
const days = [...m2DefaultActiveDays]

test('canonical array of four own plain/frozen rows remains a truthful match', () => {
  assert.equal(m3FieldSheetMatchesPlannerWeek(meals, days), true)
  assert.equal(m3FieldSheetMatchesPlannerWeek(
    Object.freeze(structuredClone(meals).reverse()), Object.freeze([...days].reverse())), true)
})

for (let index = 0; index < meals.length; index++) {
  test('inherited numeric planned-meal slot ' + index + ' must not masquerade as a recorded row', () => {
    const rows = structuredClone(meals)
    const expectedRow = rows[index]
    delete rows[index]
    const localPrototype = Object.create(Array.prototype)
    Object.defineProperty(localPrototype, String(index), {
      value: structuredClone(expectedRow), enumerable: true, configurable: true,
    })
    Object.setPrototypeOf(rows, localPrototype)
    assert.equal(Array.isArray(rows), true)
    assert.equal(rows.length, 4)
    assert.equal(Object.hasOwn(rows, index), false)
    assert.deepEqual(rows[index], expectedRow)
    assert.equal(m3FieldSheetMatchesPlannerWeek(rows, days), false)
  })
  test('getter numeric planned-meal slot ' + index + ' must be refused without invocation', () => {
    const rows = structuredClone(meals)
    let invoked = 0
    Object.defineProperty(rows, String(index), {
      configurable: true,
      enumerable: true,
      get() {
        invoked++
        return structuredClone(meals[index])
      },
    })
    assert.equal(m3FieldSheetMatchesPlannerWeek(rows, days), false)
    assert.equal(invoked, 0, 'never execute untrusted lazy slot to create false field-week proof')
    assert.equal(rows.length, 4)
  })
}

test('missing planned-meal index must still refuse and original private M2 plan remains unchanged', () => {
  for (let index = 0; index < meals.length; index++) {
    const rows = structuredClone(meals)
    delete rows[index]
    assert.equal(m3FieldSheetMatchesPlannerWeek(rows, days), false)
  }
  assert.deepEqual(m2InitialPlan, meals)
})
