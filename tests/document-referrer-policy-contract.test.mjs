import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8')

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

function referrerMetadata(source) {
  return [...source.matchAll(/<meta\b[^>]*>/gi)]
    .map(([tag]) => attributes(tag))
    .filter((attrs) => attrs.name?.trim().toLowerCase() === 'referrer')
}

test('document shell prevents referrer leakage by default', () => {
  const referrerTags = referrerMetadata(indexHtml)

  assert.equal(
    referrerTags.length,
    1,
    'index.html must declare exactly one document-level referrer policy',
  )
  assert.equal(
    referrerTags[0].content?.trim().toLowerCase(),
    'no-referrer',
    'document-level referrer policy must remain no-referrer',
  )
})

test('referrer parser exposes unquoted duplicates without attribute-value bleed', () => {
  const source = [
    '<meta name="referrer" content="no-referrer">',
    '<meta name=referrer content=unsafe-url>',
    '<meta data-note="name=referrer content=unsafe-url">',
  ].join('')

  assert.deepEqual(
    referrerMetadata(source).map((attrs) => attrs.content),
    ['no-referrer', 'unsafe-url'],
  )
})
