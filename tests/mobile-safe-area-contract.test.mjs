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

  assert.match(styles, /env\(safe-area-inset-bottom\)/)
})
