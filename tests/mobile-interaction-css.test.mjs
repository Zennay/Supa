import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const css = await readFile('src/styles.css', 'utf8')

test('mobile chrome reserves bottom safe-area space', () => {
  assert.match(css, /padding-bottom:\s*calc\(92px \+ env\(safe-area-inset-bottom\)\)/)
  assert.match(css, /bottom:\s*calc\(14px \+ env\(safe-area-inset-bottom\)\)/)
})

test('mobile shell prefers the dynamic viewport with a vh fallback', () => {
  assert.match(css, /body\s*{[\s\S]*?min-height:\s*100vh;[\s\S]*?min-height:\s*100dvh;/)
  assert.match(css, /\.app-shell\s*{[\s\S]*?min-height:\s*100vh;[\s\S]*?min-height:\s*100dvh;/)
  assert.match(
    css,
    /@media \(min-width: 700px\)[\s\S]*?\.app-shell\s*{[\s\S]*?min-height:\s*calc\(100vh - 48px\);[\s\S]*?min-height:\s*calc\(100dvh - 48px\);/,
  )
})

test('interactive controls expose visible keyboard focus', () => {
  assert.match(css, /button:focus-visible[\s\S]*input:focus-visible[\s\S]*select:focus-visible/)
  assert.match(css, /outline:\s*3px solid var\(--ink\)/)
  assert.match(css, /outline-offset:\s*3px/)
})

test('primary mobile controls meet the 44px touch-target baseline', () => {
  assert.match(css, /\.avatar\s*{[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/)
  assert.match(css, /\.ghost-button\s*{[\s\S]*?min-height:\s*44px;/)
  assert.match(css, /\.bottom-nav button\s*{[\s\S]*?min-height:\s*44px;/)
  assert.match(css, /\.shopping-row\s*{[\s\S]*?min-height:\s*56px;/)
})

test('reduced-motion preference disables non-essential motion', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(css, /animation-duration:\s*\.01ms !important;/)
  assert.match(css, /transition-duration:\s*\.01ms !important;/)
})
