import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../src/features/shopping-list/ShoppingListView.tsx', import.meta.url),
  'utf8',
)

test('shopping rows expose explicit button and toggle state semantics', () => {
  assert.match(source, /<button\s+[\s\S]*?type="button"/)
  assert.match(source, /<button\s+[\s\S]*?aria-pressed=\{checked\}/)
})
