import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const scanner = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const original = fileURLToPath(new URL('./' + scanner, import.meta.url))

function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-numeric-entity-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3'), { recursive: true })
    copyFileSync(original, join(root, 'tests', scanner))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Disposable synthetic M3 fixture\n')
    writeFileSync(join(root, 'evidence', 'm3', 'sample.md'), note + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', scanner)], {
      cwd: root, env, encoding: 'utf8', timeout: 20000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null, 'scanner must finish')
    return child
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// Numeric character references are rendered as ordinary punctuation by HTML
// (also in rendered Markdown labels). These are fabricated field values only.
for (const [label, note] of [
  ['decimal underscore in an ordered item', '1. participant&#95;name: synthetic-value'],
  ['decimal hyphen in a task item', '- [ ] account&#45;id = synthetic-value'],
  ['decimal dot inside quoted list', '> "full&#46;name": synthetic-value'],
  ['hex hyphen in a Markdown table code label', '| `e&#x2D;mail&#x2D;adres` | synthetic-value |'],
  ['hex underscore in an HTML table cell', '<table><tr><td>participant&#x5f;email</td><td>synthetic-value</td></tr></table>'],
]) {
  test('QA M3 expected RED: numeric HTML entity disclosure: ' + label, () => {
    const child = scan(note)
    assert.equal(child.status, 1, 'rendered label escaped scanner:\n' + note + '\n' + child.stdout + child.stderr)
    assert.match(child.stdout + child.stderr, /obvious participant identifier/)
  })
}

test('QA M3 controls: explanation, pseudonyms and groceries remain accepted', () => {
  for (const note of [
    '1. Explain that participant&#95;name is a prohibited label, without writing a value.',
    '- participantKey: synthetic-pseudonym',
    '| ingredient&#46;id | broccoli |',
    '<td>store&#45;name</td><td>PLUS</td>',
    'The &#95; symbol separates terms in documentation.',
  ]) {
    const child = scan(note)
    assert.equal(child.status, 0, 'safe metadata falsely rejected:\n' + note + '\n' + child.stdout + child.stderr)
  }
})
