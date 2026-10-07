import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const attributes = await readFile(new URL('../.gitattributes', import.meta.url), 'utf8')
const editorConfig = await readFile(new URL('../.editorconfig', import.meta.url), 'utf8')

function parseEditorConfig(source) {
  const sections = []
  const settings = []
  let section = null

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue

    const sectionMatch = line.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      section = sectionMatch[1]
      sections.push(section)
      continue
    }

    const settingMatch = line.match(/^([^=]+?)\s*=\s*(.*?)\s*$/)
    assert.ok(settingMatch, `invalid EditorConfig line: ${line}`)
    settings.push({
      section,
      key: settingMatch[1].trim().toLowerCase(),
      value: settingMatch[2].trim().toLowerCase(),
    })
  }

  return { sections, settings }
}

function assertEditorConfigDefaults(source) {
  const { sections, settings } = parseEditorConfig(source)
  const values = (section, key) => settings
    .filter((entry) => entry.section === section && entry.key === key)
    .map((entry) => entry.value)

  assert.equal(
    sections.filter((name) => name === '*').length,
    1,
    'expected exactly one global [*] EditorConfig section',
  )
  assert.deepEqual(values(null, 'root'), ['true'])
  assert.deepEqual(values('*', 'charset'), ['utf-8'])
  assert.deepEqual(values('*', 'end_of_line'), ['lf'])
  assert.deepEqual(values('*', 'insert_final_newline'), ['true'])
  assert.deepEqual(values('*', 'indent_style'), [])
  assert.deepEqual(values('*', 'indent_size'), [])
}

test('repository text checkouts are normalized to LF without forcing binary files to text', () => {
  const rules = attributes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  assert.deepEqual(rules, ['* text=auto eol=lf'])
})

test('editor defaults keep text UTF-8, LF and final-newline safe without shadowing', () => {
  assertEditorConfigDefaults(editorConfig)
})

test('editor defaults reject duplicate or shadowing global declarations', () => {
  assert.throws(
    () => assertEditorConfigDefaults(
      editorConfig.replace(
        'end_of_line = lf',
        'end_of_line = lf\nend_of_line = crlf',
      ),
    ),
    /end_of_line/,
  )

  assert.throws(
    () => assertEditorConfigDefaults(
      `${editorConfig.trimEnd()}\n\n[*]\ncharset = latin1\n`,
    ),
    /exactly one global \[\*\]/,
  )
})
