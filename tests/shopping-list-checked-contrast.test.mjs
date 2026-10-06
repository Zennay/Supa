import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

function channel(value) {
  const normalized = value / 255
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4
}

function luminance(hex) {
  const [r, g, b] = [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(foreground, background) {
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

test('checked shopping-list rows preserve readable text contrast', async () => {
  const css = await readFile('src/styles.css', 'utf8')
  const checkedBlock = css.match(/\.shopping-row\.checked\s*\{([^}]*)\}/)?.[1] ?? ''
  const checkedStrongBlock =
    css.match(/\.shopping-row\.checked strong\s*\{([^}]*)\}/)?.[1] ?? ''
  const muted = css.match(/--muted:\s*(#[0-9a-fA-F]{6})/)?.[1]

  assert.equal(
    /opacity\s*:/.test(checkedBlock),
    false,
    'checked rows must not dim the entire row because that also lowers text contrast',
  )
  assert.match(checkedStrongBlock, /color:\s*var\(--muted\)/)
  assert.match(checkedStrongBlock, /text-decoration:\s*line-through/)

  assert.ok(muted, 'the muted design token must remain defined as a hex color')
  assert.ok(
    contrastRatio(muted, '#ffffff') >= 4.5,
    'completed-row muted text must retain at least 4.5:1 contrast on the white shopping row',
  )
})
