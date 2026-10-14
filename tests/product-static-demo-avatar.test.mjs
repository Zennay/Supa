import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const component = await readFile(
  new URL('../src/components/IdentityAvatar.tsx', import.meta.url),
  'utf8',
)
const stylesheet = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

test('prototype avatar preserves the existing visual hook but is not an action', () => {
  assert.match(component, /export function IdentityAvatar\(\)/)
  assert.match(component, /<span[\s\S]*?className="avatar"/)
  assert.match(component, /data-profile-action="none"/)
  assert.doesNotMatch(component, /<button\b|<a\b|onClick\s*=|onKeyDown\s*=|tabIndex\s*=/)
  assert.match(stylesheet, /\.avatar\s*\{[\s\S]*?min-width:\s*44px/)
})

test('static avatar has an accessible non-action image name', () => {
  assert.match(component, /role="img"/)
  assert.match(component, /aria-label="Demo-avatar"/)
  assert.match(component, />\s*ZE\s*<\/span>/)
  assert.doesNotMatch(component, /aria-label="Profiel"|aria-haspopup|aria-expanded/)
})
