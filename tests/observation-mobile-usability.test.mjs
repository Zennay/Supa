import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const css = await readFile(
  new URL('../src/features/observation/ObservationView.css', import.meta.url),
  'utf8',
)

test('M3 observation controls keep mobile tap targets and input text usable', () => {
  const fieldControls = css.match(
    /\.field-grid input,[\s\S]*?\.line-fields select \{([\s\S]*?)\n\}/,
  )
  assert.ok(fieldControls)
  assert.match(fieldControls[1], /min-height:\s*44px;/)
  assert.match(fieldControls[1], /font-size:\s*16px;/)

  const summary = css.match(
    /\.observation-line summary \{([\s\S]*?)\n\}/,
  )
  assert.ok(summary)
  assert.match(summary[1], /min-height:\s*44px;/)

  const primaryButton = css.match(
    /\.primary-button \{([\s\S]*?)\n\}/,
  )
  assert.ok(primaryButton)
  assert.match(primaryButton[1], /min-height:\s*44px;/)
})


test('M3 JSON import exposes a visible keyboard focus indicator', () => {
  const importFocus = css.match(
    /\.observation-import-button:focus-within \{([\s\S]*?)\n\}/,
  )
  assert.ok(importFocus)
  assert.match(importFocus[1], /outline:\s*2px solid var\(--accent\);/)
  assert.match(importFocus[1], /outline-offset:\s*1px;/)
})
