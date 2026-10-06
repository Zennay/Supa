import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const css = readFileSync(
  new URL('../src/styles.css', import.meta.url),
  'utf8',
)

function declarationsFor(selector) {
  const escapedSelector = selector.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&')
  const rule = new RegExp(
    `(?:^|})\\s*[^{}]*${escapedSelector}[^{}]*\\{([^}]*)\\}`,
    'gm',
  )

  return [...css.matchAll(rule)].map((match) => match[1]).join('\n')
}

test('global mobile controls preserve the 44px interaction baseline', () => {
  const avatar = declarationsFor('.avatar')
  const ghostButton = declarationsFor('.ghost-button')
  const bottomNavButton = declarationsFor('.bottom-nav button')

  assert.match(avatar, /min-width:\s*44px\s*;/)
  assert.match(avatar, /min-height:\s*44px\s*;/)
  assert.match(ghostButton, /min-height:\s*44px\s*;/)
  assert.match(bottomNavButton, /min-height:\s*44px\s*;/)
})
