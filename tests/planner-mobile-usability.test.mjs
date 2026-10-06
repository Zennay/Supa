import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const css = await readFile('src/features/planner/planner.css', 'utf8')

test('Planner budget controls meet the 44px touch-target baseline', () => {
  assert.match(
    css,
    /\.budget-chip\s*\{[\s\S]*?min-height:\s*44px;/,
  )
})

test('Planner day toggles meet the 44px touch-target baseline without grid overlap', () => {
  assert.match(
    css,
    /\.meal-config\s*\{[\s\S]*?grid-template-columns:\s*42px 1fr 44px;/,
  )
  assert.match(
    css,
    /\.plan-check\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/,
  )
})


test('Planner recipe selectors meet the 44px touch-target baseline', () => {
  assert.match(
    css,
    /\.meal-copy select\s*\{[\s\S]*?min-height:\s*44px;/,
  )
})
