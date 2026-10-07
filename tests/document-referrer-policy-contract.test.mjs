import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8')

test('document shell prevents referrer leakage by default', () => {
  const referrerTags = [
    ...indexHtml.matchAll(/<meta\b[^>]*\bname=["']referrer["'][^>]*>/gi),
  ].map((match) => match[0])

  assert.equal(
    referrerTags.length,
    1,
    'index.html must declare exactly one document-level referrer policy',
  )
  assert.match(
    referrerTags[0],
    /\bcontent=["']no-referrer["']/i,
    'document-level referrer policy must remain no-referrer',
  )
})
