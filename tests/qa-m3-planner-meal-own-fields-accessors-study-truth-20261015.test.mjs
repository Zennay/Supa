import assert from 'node:assert/strict'
import test from 'node:test'
import { m2DefaultActiveDays, m2InitialPlan } from '../src/data/m2Fixture.ts'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { m3FieldSheetMatchesPlannerWeek } from '../src/features/observation/m3PlannerMeasurementWeek.ts'

// Independent acceptance of frozen M3 Planner-to-field-sheet truth after sparse
// active-day fix #3013. This is entirely offline, synthetic and read-only.
// A row with inherited/accessor fields must not masquerade as observed own,
// stable, persisted data just because property LOOKUP returns canonical values.
const original = structuredClone(m2InitialPlan)
const allowedDays = [...m2DefaultActiveDays]
const modes = [
  'inherited-day',
  'inherited-recipe',
  'inherited-both',
  'getter-day',
  'getter-recipe',
  'getter-both',
]

function corruptRow(source, mode) {
  if (mode === 'inherited-day') {
    return Object.assign(Object.create({ day: source.day }), { recipeId: source.recipeId })
  }
  if (mode === 'inherited-recipe') {
    return Object.assign(Object.create({ recipeId: source.recipeId }), { day: source.day })
  }
  if (mode === 'inherited-both') return Object.create({ day: source.day, recipeId: source.recipeId })
  const row = {}
  Object.defineProperty(row, 'day', mode === 'getter-day' || mode === 'getter-both'
    ? { enumerable: true, configurable: true, get: () => source.day }
    : { enumerable: true, configurable: true, value: source.day })
  Object.defineProperty(row, 'recipeId', mode === 'getter-recipe' || mode === 'getter-both'
    ? { enumerable: true, configurable: true, get: () => source.recipeId }
    : { enumerable: true, configurable: true, value: source.recipeId })
  return row
}

test('M3 positive control: canonical, reordered and frozen own-data rows match, while real field paper remains unclaimed', () => {
  assert.equal(m3FieldSheetMatchesPlannerWeek(original, allowedDays), true)
  assert.equal(m3FieldSheetMatchesPlannerWeek(
    structuredClone(original).reverse(), [...allowedDays].reverse()), true)
  const rows = structuredClone(original).map(row => Object.freeze(row))
  assert.equal(m3FieldSheetMatchesPlannerWeek(Object.freeze(rows), Object.freeze([...allowedDays])), true)
  const sheet = buildObservationSheet()
  assert.equal(sheet.baseline.lines.length, 11)
  assert.equal(sheet.candidate.lines.length, 11)
  assert.equal(sheet.evidenceStatus, 'collection-template-not-evidence')
  assert.ok(sheet.baseline.lines.every(line => line.observedProduct.priceCents === null))
})

for (const mode of modes) {
  for (let index = 0; index < original.length; index++) {
    test('M3 must reject plannedMeal ' + mode + ' on day ' + original[index].day, () => {
      const meals = structuredClone(original)
      meals[index] = corruptRow(meals[index], mode)
      const originalDay = original[index].day
      assert.equal(meals[index].day, originalDay, 'lookups masquerade as canonical to isolate provenance')
      assert.equal(meals[index].recipeId, original[index].recipeId)
      assert.equal(m3FieldSheetMatchesPlannerWeek(meals, allowedDays), false,
        mode + ' on day ' + originalDay + ' is not an own-data planned recipe, must warn')
      assert.deepEqual(m2InitialPlan, original)
    })
  }
}

test('M3: ordinary changed and duplicated own-data plan rows continue to fail closed', () => {
  for (let i = 0; i < original.length; i++) {
    const changed = structuredClone(original)
    changed[i].recipeId = changed[i].recipeId === 'pasta' ? 'tikka' : 'pasta'
    assert.equal(m3FieldSheetMatchesPlannerWeek(changed, allowedDays), false)
    const duplicate = structuredClone(original)
    duplicate[i].day = duplicate[(i + 1) % original.length].day
    assert.equal(m3FieldSheetMatchesPlannerWeek(duplicate, allowedDays), false)
  }
  assert.deepEqual(m2InitialPlan, original)
})
