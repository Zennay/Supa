import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const css = readFileSync(
  new URL('../src/styles.css', import.meta.url),
  'utf8',
)

function extractCssBlock(source, marker) {
  const markerIndex = source.indexOf(marker)
  assert.notEqual(markerIndex, -1, `missing CSS marker: ${marker}`)

  const openBrace = source.indexOf('{', markerIndex)
  assert.notEqual(openBrace, -1, `missing opening brace after: ${marker}`)

  let depth = 0
  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1

    if (depth === 0) {
      return source.slice(markerIndex, index + 1)
    }
  }

  assert.fail(`unterminated CSS block after: ${marker}`)
}

test('global CSS preserves the reduced-motion accessibility fallback', () => {
  const reducedMotionCss = extractCssBlock(
    css,
    '@media (prefers-reduced-motion: reduce)',
  )

  assert.match(
    reducedMotionCss,
    /\*\s*,\s*\*::before\s*,\s*\*::after\s*\{/,
  )
  assert.match(reducedMotionCss, /scroll-behavior:\s*auto\s*!important\s*;/)
  assert.match(reducedMotionCss, /animation-duration:\s*\.01ms\s*!important\s*;/)
  assert.match(reducedMotionCss, /animation-iteration-count:\s*1\s*!important\s*;/)
  assert.match(reducedMotionCss, /transition-duration:\s*\.01ms\s*!important\s*;/)
})
