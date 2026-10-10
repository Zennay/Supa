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


test('Planner recipe selectors meet the mobile control baseline', () => {
  const selector = css.match(/\.meal-copy select\s*\{([\s\S]*?)\n\}/)
  assert.ok(selector)
  assert.match(selector[1], /min-height:\s*44px;/)
  assert.match(selector[1], /font-size:\s*16px;/)
})

test('Planner meal cards do not advertise clickability on dead space', () => {
  const mealConfig = css.match(/\.meal-config\s*\{([\s\S]*?)\n\}/)
  assert.ok(mealConfig)
  assert.doesNotMatch(mealConfig[1], /cursor:\s*pointer/)
})
