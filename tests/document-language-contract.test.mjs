import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')

test('document root keeps Dutch language metadata', () => {
  assert.match(html, /<html\s+lang=["']nl["']>/)
})
