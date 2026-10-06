import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8')

function viewportContent(html) {
  const tag = html.match(/<meta\b[^>]*\bname=["']viewport["'][^>]*>/i)?.[0] ?? ''
  return tag.match(/content=["']([^"']*)["']/i)?.[1] ?? ''
}

test('mobile viewport keeps browser zoom available', () => {
  const viewport = viewportContent(indexHtml)

  assert.doesNotMatch(viewport, /(?:^|,)\s*user-scalable\s*=\s*no\s*(?:,|$)/i)
  assert.doesNotMatch(
    viewport,
    /(?:^|,)\s*maximum-scale\s*=\s*(?:0(?:\.\d+)?|1(?:\.0+)?)\s*(?:,|$)/i,
  )
})
