import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8')

function viewportContents(html) {
  // Match all declarations, including multiline tags and reversed attribute order.
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? []
  return metaTags
    .filter((tag) => /\sname\s*=\s*(["'])viewport\1/i.test(tag))
    .map((tag) => tag.match(/\scontent\s*=\s*(["'])(.*?)\1/is)?.[2] ?? null)
}

function assertZoomSafe(html) {
  const viewports = viewportContents(html)
  assert.equal(viewports.length, 1, 'exactly one viewport declaration is required')

  const viewport = viewports[0]
  assert.ok(typeof viewport === 'string' && viewport.trim(), 'viewport content is required')

  const declarations = viewport.split(',').map((entry) => entry.trim())
  for (const declaration of declarations) {
    const match = declaration.match(/^([^=]+)\s*=\s*(.+)$/)
    if (!match) continue
    const key = match[1].trim().toLowerCase()
    const value = match[2].trim().toLowerCase()
    if (key === 'user-scalable') {
      assert.notEqual(value, 'no', 'viewport must not disable user zoom')
      assert.notEqual(value, '0', 'viewport must not disable user zoom')
    }
    if (key === 'maximum-scale') {
      const limit = Number(value)
      assert.ok(Number.isFinite(limit) && limit > 1, 'maximum-scale must allow zoom beyond 100%')
    }
  }
}

test('mobile viewport keeps browser zoom available', () => {
  assertZoomSafe(indexHtml)
})

test('mobile viewport rejects hidden duplicate declarations, even if the first is safe', () => {
  for (const duplicate of [
    '<meta name="viewport" content="width=device-width, user-scalable=no">',
    '<meta content="maximum-scale=1" NAME="VIEWPORT">',
    '<meta\n name="viewport"\n content="user-scalable=0">',
  ]) {
    const html = indexHtml.replace('</head>', `  ${duplicate}\n</head>`)
    assert.throws(() => assertZoomSafe(html), /exactly one viewport/, duplicate)
  }
})

test('mobile viewport must have one nonempty viewport content attribute', () => {
  const missing = indexHtml.replace(
    /<meta\s+name="viewport"\s+content="[^"]*"\s*\/>/s,
    '<meta name="viewport">',
  )
  assert.throws(() => assertZoomSafe(missing), /viewport content is required/)
})

test('mobile viewport rejects all restrictive zoom spellings', () => {
  for (const rule of [
    'user-scalable=no',
    'user-scalable=0',
    'maximum-scale=0.5',
    'maximum-scale=1',
    'maximum-scale=1.0',
    'maximum-scale=1e0',
  ]) {
    const html = indexHtml.replace('viewport-fit=cover', `viewport-fit=cover, ${rule}`)
    assert.throws(() => assertZoomSafe(html), /zoom|maximum-scale/, rule)
  }
})
