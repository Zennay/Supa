import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const css = readFileSync(
  new URL('../src/styles.css', import.meta.url),
  'utf8',
)

function cssVariable(name) {
  const value = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`))?.[1]
  assert.ok(value, `missing CSS color variable --${name}`)
  return value
}

function relativeLuminance(hex) {
  const channels = hex
    .slice(1)
    .match(/../g)
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4,
    )

  return (
    0.2126 * channels[0] +
    0.7152 * channels[1] +
    0.0722 * channels[2]
  )
}

function contrastRatio(first, second) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (lighter + 0.05) / (darker + 0.05)
}

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

test('focus ink keeps non-text contrast against global interactive surfaces', () => {
  const ink = cssVariable('ink')

  for (const surface of ['surface', 'surface-strong', 'accent']) {
    assert.ok(
      contrastRatio(ink, cssVariable(surface)) >= 3,
      `--ink focus indicator must keep at least 3:1 contrast against --${surface}`,
    )
  }
})
