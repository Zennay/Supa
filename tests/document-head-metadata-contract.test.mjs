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

function charsetDeclarations(source) {
  return [
    ...source.matchAll(
      /<meta\b[^>]*\bcharset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))[^>]*>/gi,
    ),
  ].map((match) => match[1] ?? match[2] ?? match[3] ?? '')
}

test('document head keeps one UTF-8 charset and SUPA title', () => {
  const charsets = charsetDeclarations(html)
  const titles = [...html.matchAll(/<title>\s*([^<]+?)\s*<\/title>/gi)]

  assert.equal(charsets.length, 1, 'expected exactly one charset meta declaration')
  assert.equal(charsets[0].trim().toLowerCase(), 'utf-8')
  assert.equal(titles.length, 1, 'expected exactly one document title')
  assert.equal(titles[0][1].trim(), 'SUPA')
})

test('charset parser exposes conflicting quoted and unquoted declarations', () => {
  assert.deepEqual(
    charsetDeclarations(
      '<meta charset="UTF-8"><meta charset=windows-1252><meta name="description" content="charset=ignored">',
    ),
    ['UTF-8', 'windows-1252'],
  )
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
