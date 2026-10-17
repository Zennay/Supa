import assert from 'node:assert/strict'
import test from 'node:test'
import { selectedFixtureWeek } from '../scripts/retailer-reviewed-custom-week.mjs'
import { m3StudyWeekAlignment } from '../scripts/m3-field-plan-alignment.mjs'
import { m2DefaultActiveDays } from '../src/data/m2Fixture.ts'

test('product: empty, own, frozen own review arguments preserve legitimate private fixture choices', () => {
  assert.deepEqual(selectedFixtureWeek().days, m2DefaultActiveDays)
  assert.deepEqual(selectedFixtureWeek([]).days, m2DefaultActiveDays)
  assert.deepEqual(selectedFixtureWeek(Object.freeze(['--days', 'Ma,Do'])).days, ['Ma', 'Do'])
  assert.deepEqual(selectedFixtureWeek(['--days', 'Do,Ma']).days, ['Ma', 'Do'])
  const custom = selectedFixtureWeek(Object.freeze(['--plan', 'Ma:pasta,Do:teriyaki']))
  assert.deepEqual(custom.days, ['Ma', 'Do'])
  assert.equal(custom.plan.find(meal => meal.day === 'Ma').recipeId, 'pasta')
  assert.equal(custom.plan.find(meal => meal.day === 'Do').recipeId, 'teriyaki')
  assert.equal(m3StudyWeekAlignment(['--days', 'Ma,Do']).matchesFixedWorksheetDemand, false)
})

test('product: own accessors and inherited arguments cannot control shared reviewed-week parser', () => {
  for (const index of [0, 1]) {
    const accessor = ['--days', 'Ma,Di,Wo,Do']
    let calls = 0
    const original = accessor[index]
    Object.defineProperty(accessor, String(index), {
      configurable: true, get() { calls++; return original },
    })
    assert.throws(() => selectedFixtureWeek(accessor))
    assert.equal(calls, 0)

    const inherited = ['--days', 'Ma,Di,Wo,Do']
    delete inherited[index]
    const proto = Object.create(Array.prototype)
    Object.defineProperty(proto, String(index), {
      get() { calls++; return original },
    })
    Object.setPrototypeOf(inherited, proto)
    assert.throws(() => selectedFixtureWeek(inherited))
    assert.equal(calls, 0)
  }
})

test('product: Proxy GET traps cannot supply apparently valid private reviewed-week tokens', () => {
  for (const index of [0, 1]) {
    let calls = 0
    const args = new Proxy(['--days', 'Ma,Di,Wo,Do'], {
      get(target, property, receiver) {
        if (property === String(index)) calls++
        return Reflect.get(target, property, receiver)
      },
    })
    assert.throws(() => selectedFixtureWeek(args))
    assert.equal(calls, 0)
  }
})

test('product: sparse and invalid inputs refuse to create a successful fixed field-study plan', () => {
  const candidates = [
    Array(2), ['--days'], ['--plan', ''], ['--days', 23],
    ['--days', 'Ma,Ma'], ['--days', 'XX'], ['--plan', 'Ma:unknown'],
  ]
  for (const argv of candidates) {
    assert.throws(() => selectedFixtureWeek(argv))
    assert.throws(() => m3StudyWeekAlignment(argv))
  }
})
