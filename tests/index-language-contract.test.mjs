import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8')

test('document language stays Dutch for the Dutch product UI', () => {
  const htmlTag = indexHtml.match(/<html\b[^>]*>/i)?.[0] ?? ''

  assert.match(htmlTag, /\blang=["']nl["']/i)
})
