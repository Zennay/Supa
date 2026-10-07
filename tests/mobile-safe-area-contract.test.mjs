import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

function viewportDirectives(content) {
  return new Map(
    content
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...rawValue] = directive.split('=')
        return [
          name.trim().toLowerCase(),
          rawValue.join('=').trim().toLowerCase(),
        ]
      }),
  )
}

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

test('mobile viewport keeps browser zoom available', () => {
  const viewportTag =
    indexHtml.match(/<meta\b[^>]*\bname=["']viewport["'][^>]*>/i)?.[0] ?? ''
  const viewportContent =
    viewportTag.match(/content=["']([^"']*)["']/i)?.[1] ?? ''
  const directives = viewportDirectives(viewportContent)

  assert.ok(
    !['no', '0', 'false'].includes(directives.get('user-scalable')),
    'viewport must not disable user scaling',
  )

  const maximumScale = directives.get('maximum-scale')
  if (maximumScale !== undefined) {
    const parsedMaximumScale = Number(maximumScale)
    assert.ok(
      Number.isFinite(parsedMaximumScale) && parsedMaximumScale >= 2,
      'viewport maximum-scale must allow at least 200% zoom',
    )
  }
})
