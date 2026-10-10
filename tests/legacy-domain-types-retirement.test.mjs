import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const typesSource = await readFile(
  new URL('../src/domain/types.ts', import.meta.url),
  'utf8',
)

test('public domain exports no longer advertise unused prototype types', () => {
  assert.doesNotMatch(typesSource, /export\s+type\s+(?:Product|PriceObservation)\b/)
})

test('retiring prototypes leaves consumed domain contracts available', () => {
  for (const name of [
    'Store',
    'PriceSource',
    'Recipe',
    'PlannedMeal',
    'BasketLine',
    'BasketSummary',
  ]) {
    assert.match(typesSource, new RegExp(`export\\s+type\\s+${name}\\b`))
  }
})
