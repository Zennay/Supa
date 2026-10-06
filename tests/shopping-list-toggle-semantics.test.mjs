import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../src/features/shopping-list/ShoppingListView.tsx', import.meta.url),
  'utf8',
)

test('shopping rows expose explicit toggle-button semantics', () => {
  const buttonTag = source.match(/<button\b[\s\S]*?>/)?.[0] ?? ''

  assert.match(buttonTag, /\btype=["']button["']/)
  assert.match(buttonTag, /\baria-pressed=\{checked\}/)
})
