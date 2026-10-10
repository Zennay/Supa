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

test('App buttons are explicitly non-submit controls', async () => {
  const source = await readFile('src/App.tsx', 'utf8')
  const buttonTags = [...source.matchAll(/<button\b[\s\S]*?>/g)].map(([tag]) => tag)

  assert.ok(buttonTags.length >= 1)
  for (const tag of buttonTags) {
    assert.match(tag, /\btype=["']button["']/)
  }
})

test('prototype app shell has no misleading interactive profile control', async () => {
  const source = await readFile('src/App.tsx', 'utf8')
  assert.match(source, /import \\{ IdentityAvatar \\} from/)
  assert.match(source, /<IdentityAvatar \\/>/)
  assert.doesNotMatch(source, /<button[^>]+aria-label="Profiel"/)
  assert.doesNotMatch(source, /<a[^>]+aria-label="Profiel"/)
  assert.match(source, /<nav className="bottom-nav" aria-label="Hoofdnavigatie">/)
})
