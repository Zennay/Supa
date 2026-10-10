import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

test('mobile viewport enables the safe-area contract used by fixed navigation', () => {
  const viewportTag =
    indexHtml.match(/<meta\b[^>]*\bname=["']viewport["'][^>]*>/i)?.[0] ?? ''
  const viewportContent =
    viewportTag.match(/content=["']([^"']*)["']/i)?.[1] ?? ''

  assert.match(viewportContent, /(?:^|,)\s*width=device-width\s*(?:,|$)/i)
  assert.match(viewportContent, /(?:^|,)\s*initial-scale=1(?:\.0)?\s*(?:,|$)/i)
  assert.match(viewportContent, /(?:^|,)\s*viewport-fit=cover\s*(?:,|$)/i)

  assert.match(styles, /env\(safe-area-inset-top\)/)
  assert.match(styles, /env\(safe-area-inset-bottom\)/)
  assert.match(styles, /env\(safe-area-inset-left\)/)
  assert.match(styles, /env\(safe-area-inset-right\)/)
  assert.match(
    styles,
    /\.topbar\s*{[\s\S]*?padding:\s*calc\(18px \+ env\(safe-area-inset-top\)\) 20px 12px;/,
  )
  assert.match(
    styles,
    /\.topbar\s*{[\s\S]*?padding-left:\s*calc\(20px \+ env\(safe-area-inset-left\)\);[\s\S]*?padding-right:\s*calc\(20px \+ env\(safe-area-inset-right\)\);/,
  )
  assert.match(
    styles,
    /\.content\s*{[\s\S]*?padding-left:\s*calc\(18px \+ env\(safe-area-inset-left\)\);[\s\S]*?padding-right:\s*calc\(18px \+ env\(safe-area-inset-right\)\);/,
  )
  assert.match(
    styles,
    /\.bottom-nav\s*{[\s\S]*?width:\s*min\(calc\(100% - 28px\), 532px\);[\s\S]*?max\(env\(safe-area-inset-left\), env\(safe-area-inset-right\)\)[\s\S]*?max\(env\(safe-area-inset-left\), env\(safe-area-inset-right\)\)/,
  )
})
