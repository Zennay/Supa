import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const attributes = await readFile(new URL('../.gitattributes', import.meta.url), 'utf8')
const editorConfig = await readFile(new URL('../.editorconfig', import.meta.url), 'utf8')

test('repository text checkouts are normalized to LF without forcing binary files to text', () => {
  const rules = attributes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  assert.deepEqual(rules, ['* text=auto eol=lf'])
})

test('editor defaults keep text UTF-8, LF and final-newline safe', () => {
  assert.match(editorConfig, /^root\s*=\s*true\s*$/m)
  assert.match(editorConfig, /^\[\*\]\s*$/m)
  assert.match(editorConfig, /^charset\s*=\s*utf-8\s*$/m)
  assert.match(editorConfig, /^end_of_line\s*=\s*lf\s*$/m)
  assert.match(editorConfig, /^insert_final_newline\s*=\s*true\s*$/m)

  assert.doesNotMatch(editorConfig, /^indent_(?:style|size)\s*=/m)
})
