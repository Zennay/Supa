import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../vite.config.ts', import.meta.url),
  'utf8',
)

test('Vite config keeps the React plugin integration', () => {
  assert.match(
    source,
    /import\s+react\s+from\s+['"]@vitejs\/plugin-react['"]/,
    'vite.config.ts must keep the React plugin import',
  )
  assert.match(
    source,
    /plugins\s*:\s*\[\s*react\(\)\s*\]/s,
    'vite.config.ts must keep react() registered in the plugin list',
  )
})
