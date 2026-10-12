import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const plannerViewSource = await readFile(
  new URL('../src/features/planner/PlannerView.tsx', import.meta.url),
  'utf8',
)

test('Planner buttons are non-submit except the intentional custom-budget form submit', () => {
  const buttonTags = [...plannerViewSource.matchAll(/<button\b[\s\S]*?>/g)].map(
    ([tag]) => tag,
  )

  // Presets, reset, custom toggle, and the explicit cancel all stay
  // non-submitting; only the intentional save action submits.
  assert.equal(buttonTags.length, 6)
  assert.match(plannerViewSource, />Annuleren<\/button>/)
  const submits = buttonTags.filter((tag) => /\btype=["']submit["']/.test(tag))
  assert.equal(submits.length, 1, 'Only the opt-in custom budget may submit')
  assert.match(plannerViewSource, /<form\b[^>]*onSubmit=\{commitCustomBudget\}/)
  for (const tag of buttonTags.filter((tag) => !submits.includes(tag))) {
    assert.match(tag, /\btype=["']button["']/)
  }
})
