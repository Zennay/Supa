import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const typesSource = await readFile(new URL('../src/domain/types.ts', import.meta.url), 'utf8')

test('prototype domain contracts are removed without exposing stale types', () => {
  for (const name of ['Product', 'PriceObservation', 'PriceSource', 'BasketLine', 'BasketSummary']) {
    assert.doesNotMatch(typesSource, new RegExp(`export\\s+type\\s+${name}\\b`))
  }
})

test('live planner and recipe public contracts remain available', () => {
  for (const name of ['Store', 'Recipe', 'PlannedMeal']) {
    assert.match(typesSource, new RegExp(`export\\s+type\\s+${name}\\b`))
  }
})
