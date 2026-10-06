import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const plannerViewSource = await readFile(
  new URL('../src/features/planner/PlannerView.tsx', import.meta.url),
  'utf8',
)

test('Planner buttons are explicitly non-submit controls', () => {
  const buttonTags = [...plannerViewSource.matchAll(/<button\\b[\\s\\S]*?>/g)].map(
    ([tag]) => tag,
  )

  assert.equal(buttonTags.length, 3)

  for (const tag of buttonTags) {
    assert.match(tag, /\\btype=["']button["']/)
  }
})
