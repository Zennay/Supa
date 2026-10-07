import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

function attributes(tag) {
  const result = {}
  const tagName = tag.match(/^<\s*[^\s/>]+/)
  if (!tagName) return result

  let index = tagName[0].length

  while (index < tag.length) {
    while (index < tag.length && /\s/.test(tag[index])) index += 1
    if (index >= tag.length || tag[index] === '>') break
    if (tag[index] === '/') {
      index += 1
      continue
    }

    const nameStart = index
    while (index < tag.length && !/[\s=/>]/.test(tag[index])) index += 1
    const name = tag.slice(nameStart, index).toLowerCase()
    if (!name) {
      index += 1
      continue
    }

    while (index < tag.length && /\s/.test(tag[index])) index += 1

    let value = ''
    if (tag[index] === '=') {
      index += 1
      while (index < tag.length && /\s/.test(tag[index])) index += 1

      const quote = tag[index] === '"' || tag[index] === "'" ? tag[index] : null
      if (quote) {
        index += 1
        const valueStart = index
        while (index < tag.length && tag[index] !== quote) index += 1
        value = tag.slice(valueStart, index)
        if (tag[index] === quote) index += 1
      } else {
        const valueStart = index
        while (index < tag.length && !/[\s>]/.test(tag[index])) index += 1
        value = tag.slice(valueStart, index)
      }
    }

    result[name] = value
  }

  return result
}

function namedMeta(name, source = html) {
  return [...source.matchAll(/<meta\b[^>]*>/gi)]
    .map(([tag]) => attributes(tag))
    .filter((attrs) => attrs.name?.toLowerCase() === name)
}

function charsetDeclarations(source) {
  return [...source.matchAll(/<meta\b[^>]*>/gi)]
    .map(([tag]) => attributes(tag))
    .filter((attrs) => Object.hasOwn(attrs, 'charset'))
    .map((attrs) => attrs.charset)
}

function titleTexts(source) {
  return [...source.matchAll(/<title\b[^>]*>\s*([^<]+?)\s*<\/title>/gi)]
    .map((match) => match[1].trim())
}

test('document head keeps one UTF-8 charset and SUPA title', () => {
  const charsets = charsetDeclarations(html)
  const titles = titleTexts(html)

  assert.equal(charsets.length, 1, 'expected exactly one charset meta declaration')
  assert.equal(charsets[0].trim().toLowerCase(), 'utf-8')
  assert.equal(titles.length, 1, 'expected exactly one document title')
  assert.equal(titles[0], 'SUPA')
})

test('title parser exposes attributed duplicate declarations', () => {
  assert.deepEqual(
    titleTexts('<title>SUPA</title><title data-source="duplicate">Other</title>'),
    ['SUPA', 'Other'],
  )
})

test('charset parser exposes conflicting quoted and unquoted declarations', () => {
  assert.deepEqual(
    charsetDeclarations(
      '<meta charset="UTF-8"><meta charset=windows-1252><meta name="description" content="charset=ignored">',
    ),
    ['UTF-8', 'windows-1252'],
  )
})

test('named metadata parser discovers quoted and unquoted declarations without value bleed', () => {
  const source = [
    '<meta name="theme-color" content="#f7f6f1">',
    '<meta name=theme-color content=#ffffff>',
    '<meta name=description content=kort>',
    '<meta data-note="name=description content=ignored">',
  ].join('')

  assert.deepEqual(
    namedMeta('theme-color', source).map((attrs) => attrs.content),
    ['#f7f6f1', '#ffffff'],
  )
  assert.deepEqual(
    namedMeta('description', source).map((attrs) => attrs.content),
    ['kort'],
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
