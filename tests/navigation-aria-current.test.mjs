import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('bottom navigation exposes the active destination with aria-current', () => {
  assert.match(
    appSource,
    /<nav className="bottom-nav" aria-label="Hoofdnavigatie">[\s\S]*aria-current=\{tab === item\.id \? 'page' : undefined\}/,
  )
})

test('bottom navigation keeps semantic state conditional instead of marking inactive tabs current', () => {
  assert.doesNotMatch(appSource, /aria-current=["']page["']/)
  assert.match(appSource, /className=\{tab === item\.id \? 'active' : ''\}/)
  assert.match(appSource, /<button[\s\S]*onClick=\{\(\) => setTab\(item\.id\)\}/)
})
