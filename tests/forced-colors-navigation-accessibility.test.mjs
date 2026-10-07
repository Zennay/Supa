import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

function cssBlock(selector) {
  const start = css.indexOf(selector)
  assert.notEqual(start, -1, `missing CSS block: ${selector}`)

  const open = css.indexOf('{', start)
  assert.notEqual(open, -1, `missing opening brace: ${selector}`)

  let depth = 0
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, index)
    }
  }

  assert.fail(`missing closing brace: ${selector}`)
}

test('forced-colors mode preserves a visible active navigation state', () => {
  const forcedColors = cssBlock('@media (forced-colors: active)')
  assert.match(forcedColors, /\.bottom-nav button\.active\s*\{[\s\S]*border:\s*2px solid ButtonText;/)
})

test('forced-colors active state does not replace the keyboard focus outline', () => {
  const forcedColors = cssBlock('@media (forced-colors: active)')
  assert.doesNotMatch(forcedColors, /outline\s*:/)

  const focusRule = css.match(
    /button:focus-visible\s*,\s*input:focus-visible\s*,\s*select:focus-visible\s*\{[^}]*\}/,
  )?.[0] ?? ''

  assert.match(focusRule, /outline:\s*3px solid var\(--ink\);/)
  assert.match(focusRule, /outline-offset:\s*3px;/)
})
