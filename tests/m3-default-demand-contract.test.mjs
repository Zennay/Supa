import assert from 'node:assert/strict'
import test from 'node:test'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

const expectedDefaultWeekDemand = [
  {
    id: 'basmati-rice',
    label: 'Basmati rijst',
    query: 'basmati rijst',
    amount: 450,
    unit: 'g',
  },
  {
    id: 'broccoli',
    label: 'Broccoli',
    query: 'broccoli',
    amount: 250,
    unit: 'g',
  },
  {
    id: 'cauliflower',
    label: 'Bloemkool',
    query: 'bloemkool',
    amount: 2,
    unit: 'piece',
  },
  {
    id: 'chicken-thigh',
    label: 'Kippendij',
    query: 'kippendij',
    amount: 600,
    unit: 'g',
  },
  {
    id: 'coconut-milk',
    label: 'Kokosmelk',
    query: 'kokosmelk',
    amount: 400,
    unit: 'ml',
  },
  {
    id: 'edamame',
    label: 'Edamame',
    query: 'edamame',
    amount: 150,
    unit: 'g',
  },
  {
    id: 'garam-masala',
    label: 'Garam masala',
    query: 'garam masala',
    amount: 20,
    unit: 'g',
  },
  {
    id: 'greek-yogurt',
    label: 'Griekse yoghurt',
    query: 'griekse yoghurt',
    amount: 100,
    unit: 'g',
  },
  {
    id: 'spaghetti',
    label: 'Spaghetti',
    query: 'spaghetti',
    amount: 250,
    unit: 'g',
  },
  {
    id: 'teriyaki-sauce',
    label: 'Teriyaki saus',
    query: 'teriyaki saus',
    amount: 60,
    unit: 'ml',
  },
  {
    id: 'tomato-cubes',
    label: 'Tomatenblokjes',
    query: 'tomatenblokjes',
    amount: 400,
    unit: 'g',
  },
]

test('M3 field collection stays bound to the complete default-week demand', () => {
  const sheet = buildObservationSheet()

  assert.equal(sheet.plannerFixture, 'm2-default-week')
  assert.equal(sheet.selectedMealCount, 4)
  assert.deepEqual(sheet.requirements, expectedDefaultWeekDemand)

  for (const side of ['baseline', 'candidate']) {
    assert.deepEqual(
      sheet[side].lines.map((line) => ({
        ingredientId: line.ingredientId,
        ingredientLabel: line.ingredientLabel,
        requirement: line.requirement,
      })),
      expectedDefaultWeekDemand.map(({ id, label, amount, unit }) => ({
        ingredientId: id,
        ingredientLabel: label,
        requirement: { amount, unit },
      })),
    )
  }
})
