import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

function attributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(
      ([, name, value]) => [name.toLowerCase(), value],
    ),
  )
}

function namedMeta(name) {
  return [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map(([tag]) => attributes(tag))
    .filter((attrs) => attrs.name?.toLowerCase() === name)
}

test('document head keeps one UTF-8 charset and SUPA title', () => {
  const charsetTags = [
    ...html.matchAll(/<meta\b[^>]*\bcharset\s*=\s*["']utf-8["'][^>]*>/gi),
  ]
  const titles = [...html.matchAll(/<title>\s*([^<]+?)\s*<\/title>/gi)]

  assert.equal(charsetTags.length, 1, 'expected exactly one UTF-8 charset meta')
  assert.equal(titles.length, 1, 'expected exactly one document title')
  assert.equal(titles[0][1].trim(), 'SUPA')
})

test('document head keeps valid theme color and uncertainty-aware description', () => {
  const themeColors = namedMeta('theme-color')
  const descriptions = namedMeta('description')

  assert.equal(themeColors.length, 1, 'expected exactly one theme-color meta')
  assert.match(themeColors[0].content ?? '', /^#[0-9a-f]{6}$/i)

  assert.equal(descriptions.length, 1, 'expected exactly one description meta')
  const description = descriptions[0].content?.trim() ?? ''
  assert.notEqual(description, '')
  assert.match(description, /\bonzekerheid\b/i)
})
