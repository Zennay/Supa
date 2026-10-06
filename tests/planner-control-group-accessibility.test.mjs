import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile('src/features/planner/PlannerView.tsx', 'utf8')

test('Planner exposes week-budget controls as a named group', () => {
  assert.match(
    source,
    /<div className="budget-options" role="group" aria-label="Kies je weekbudget">/,
  )
})

test('Planner exposes planned meals as a named control group', () => {
  assert.match(
    source,
    /<div className="day-grid" role="group" aria-label="Geplande maaltijden">/,
  )
})


test('Planner recipe selectors expose day-specific accessible names', () => {
  assert.match(
    source,
    /aria-label=\{\`Recept voor \${item\.day}\`\}/,
  )
})
