import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const css = readFileSync(
  new URL('../src/styles.css', import.meta.url),
  'utf8',
)

test('global form controls preserve a visible keyboard focus indicator', () => {
  const focusRule = css.match(
    /button:focus-visible\s*,\s*input:focus-visible\s*,\s*select:focus-visible\s*\{[^}]*\}/,
  )?.[0] ?? ''

  assert.notEqual(
    focusRule,
    '',
    'button, input and select must share the global focus-visible rule',
  )
  assert.match(focusRule, /outline:\s*3px\s+solid\s+var\(--ink\)\s*;/)
  assert.match(focusRule, /outline-offset:\s*3px\s*;/)
})
