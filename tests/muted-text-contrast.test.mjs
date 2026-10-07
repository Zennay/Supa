import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

function channelToLinear(channel) {
  const normalized = channel / 255
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4
}

function luminance(hex) {
  const value = hex.slice(1)
  const channels = [0, 2, 4].map((offset) =>
    channelToLinear(Number.parseInt(value.slice(offset, offset + 2), 16)),
  )

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = luminance(foreground)
  const backgroundLuminance = luminance(background)
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)

  return (lighter + 0.05) / (darker + 0.05)
}

function customProperty(css, name) {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))
  assert.ok(match, `missing --${name} color token`)
  return match[1]
}

function ruleBackground(css, selectorPattern) {
  const block = css.match(new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`, 's'))?.[1] ?? ''
  const match = block.match(/background:\s*(#[0-9a-fA-F]{6})/)
  assert.ok(match, `missing background for ${selectorPattern}`)
  return match[1]
}

test('muted normal text keeps at least 4.5:1 contrast on core light surfaces', async () => {
  const css = await readFile('src/styles.css', 'utf8')
  const muted = customProperty(css, 'muted')
  const surfaces = [
    ['app surface', customProperty(css, 'surface')],
    ['root shell', ruleBackground(css, ':root')],
    ['comparison total', ruleBackground(css, '\\.comparison-totals > div')],
  ]

  for (const [label, background] of surfaces) {
    const ratio = contrastRatio(muted, background)
    assert.ok(
      ratio >= 4.5,
      `${label} muted-text contrast is ${ratio.toFixed(2)}:1; expected at least 4.5:1`,
    )
  }
})
