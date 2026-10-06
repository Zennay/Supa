import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const css = readFileSync(
  new URL('../src/styles.css', import.meta.url),
  'utf8',
)

test('global CSS preserves the reduced-motion accessibility fallback', () => {
  const marker = '@media (prefers-reduced-motion: reduce)'
  const start = css.indexOf(marker)

  assert.notEqual(
    start,
    -1,
    'global CSS must expose a prefers-reduced-motion: reduce fallback',
  )

  const reducedMotionCss = css.slice(start)

  assert.match(reducedMotionCss, /scroll-behavior:\s*auto\s*!important\s*;/)
  assert.match(reducedMotionCss, /animation-duration:\s*\.01ms\s*!important\s*;/)
  assert.match(reducedMotionCss, /animation-iteration-count:\s*1\s*!important\s*;/)
  assert.match(reducedMotionCss, /transition-duration:\s*\.01ms\s*!important\s*;/)
})
