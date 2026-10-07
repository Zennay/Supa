import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const mainSource = await readFile(
  new URL('../src/main.tsx', import.meta.url),
  'utf8',
)

test('React bootstrap keeps StrictMode imported from React', () => {
  assert.match(
    mainSource,
    /import\s*\{[^}]*\bStrictMode\b[^}]*\}\s*from\s*['"]react['"]/,
  )
})

test('canonical App mount remains wrapped in StrictMode', () => {
  assert.match(
    mainSource,
    /<StrictMode>\s*<App\s*\/>\s*<\/StrictMode>/,
  )
})
