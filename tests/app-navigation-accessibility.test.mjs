import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('bottom navigation exposes the active destination semantically', async () => {
  const source = await readFile('src/App.tsx', 'utf8')

  assert.match(source, /<nav className="bottom-nav" aria-label="Hoofdnavigatie">/)
  assert.match(source, /type="button"/)
  assert.match(
    source,
    /aria-current=\{tab === item\.id \? 'page' : undefined\}/,
  )
  assert.match(source, /className=\{tab === item\.id \? 'active' : ''\}/)
})
