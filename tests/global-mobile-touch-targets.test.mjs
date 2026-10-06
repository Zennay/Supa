import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const css = readFileSync(
  new URL('../src/styles.css', import.meta.url),
  'utf8',
)

test('global mobile controls preserve the 44px interaction baseline', () => {
  const avatar = css.match(/\.avatar\s*\{[^}]*\}/)?.[0] ?? ''
  const ghostButton = css.match(/\.ghost-button\s*\{[^}]*\}/)?.[0] ?? ''
  const bottomNavButton = css.match(/\.bottom-nav button\s*\{[^}]*\}/)?.[0] ?? ''

  assert.match(avatar, /min-width:\s*44px\s*;/)
  assert.match(avatar, /min-height:\s*44px\s*;/)
  assert.match(ghostButton, /min-height:\s*44px\s*;/)
  assert.match(bottomNavButton, /min-height:\s*44px\s*;/)
})
