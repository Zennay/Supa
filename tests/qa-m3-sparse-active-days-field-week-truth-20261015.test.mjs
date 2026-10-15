import assert from 'node:assert/strict'
import test from 'node:test'
import { m2DefaultActiveDays, m2InitialPlan } from '../src/data/m2Fixture.ts'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { m3FieldSheetMatchesPlannerWeek } from '../src/features/observation/m3PlannerMeasurementWeek.ts'

// Independent quality-validation 2/2 acceptance of a UI truth contract.
// No source changes, real retailer requests, private participant data, pricing
// or permission inference. Frozen product composite PR #3010 only.
const defaultDays = [...m2DefaultActiveDays]
const defaultMeals = structuredClone(m2InitialPlan)

test('control: full canonical four-day survey plan is the only complete positive, independent of order', () => {
  assert.equal(defaultDays.length, 4)
  assert.equal(m3FieldSheetMatchesPlannerWeek(defaultMeals, defaultDays), true)
  assert.equal(m3FieldSheetMatchesPlannerWeek(
    [...defaultMeals].reverse(), [...defaultDays].reverse()), true)
  assert.equal(m3FieldSheetMatchesPlannerWeek(defaultMeals, defaultDays.slice(0, 3)), false)
  assert.equal(m3FieldSheetMatchesPlannerWeek(defaultMeals, [defaultDays[0], defaultDays[1],
    defaultDays[2], defaultDays[2]]), false)
  const sheet = buildObservationSheet()
  assert.equal(sheet.requirements.length, 11)
  assert.equal(sheet.baseline.lines.length, 11)
  assert.equal(sheet.candidate.lines.length, 11)
  assert.equal(sheet.evidenceStatus, 'collection-template-not-evidence')
})

for (let missingAt = 0; missingAt < defaultDays.length; missingAt++) {
  test('M3 warning must treat a sparse active-day slot ' + missingAt + ' as a nonmatching personal planner', () => {
    const corrupted = [...defaultDays]
    delete corrupted[missingAt]
    assert.equal(corrupted.length, 4, 'the falsified length still resembles the complete week')
    assert.equal(Object.hasOwn(corrupted, missingAt), false)
    assert.equal([...corrupted].filter(x => typeof x === 'string').length, 3)
    // Array iteration counts the hole as undefined in Set, while every()
    // skips the hole. These contradictory semantics bypass a naive 4-day check.
    assert.equal(new Set(corrupted).size, 4)
    const before = [...corrupted]
    const outcome = m3FieldSheetMatchesPlannerWeek(defaultMeals, corrupted)
    assert.equal(outcome, false,
      'incomplete personal planner must show the mismatch warning, not falsely claim fixed M3 parity')
    assert.deepEqual([...corrupted], before, 'comparison may never repair/mutate a private draft')
    assert.deepEqual(m2InitialPlan, defaultMeals)
  })
}
