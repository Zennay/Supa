import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const scanner = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const source = fileURLToPath(new URL('./' + scanner, import.meta.url))

function check(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-named-entity-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence/m3'), { recursive: true })
    copyFileSync(source, join(root, 'tests', scanner))
    writeFileSync(join(root, 'evidence/m3/README.md'), '# Synthetic M3 only\n')
    writeFileSync(join(root, 'evidence/m3/sample.md'), note + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', scanner)], {
      cwd: root, env, encoding: 'utf8', timeout: 20000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    return child
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// Valid HTML named references render punctuation before human reading of the
// Markdown. No real name, receipt, retailer observation or identifying value.
for (const [label, note] of [
  ['lowbar in ordered item', '1. participant&lowbar;name: synthetic-value'],
  ['period in quoted field', '> "full&period;name"= synthetic-value'],
  ['lowbar and named assignment', '- [x] account&lowbar;id&equals; synthetic-value'],
  ['hyphen in a Markdown table field', '| e&hyphen;mail&hyphen;adres | synthetic-value |'],
  ['lowbar in HTML cells', '<tr><td>participant&lowbar;email</td><td>synthetic-value</td></tr>'],
]) {
  test('QA M3 expected RED named HTML field entity: ' + label, () => {
    const child = check(note)
    assert.equal(child.status, 1, 'rendered named field bypassed scanner:\n' + note + '\n' + child.stdout + child.stderr)
    assert.match(child.stdout + child.stderr, /obvious participant identifier/)
  })
}

test('QA M3 named-field entity benign controls stay accepted', () => {
  for (const note of [
    'Policy: participant&lowbar;name must not be recorded with values.',
    'participantKey: synthetic-pseudonym',
    '| ingredient&period;name | broccoli |',
    '- Store&hyphen;name: PLUS',
    'Use &lowbar; as a documented separator but do not add private values.',
  ]) {
    const child = check(note)
    assert.equal(child.status, 0, 'safe note rejected:\n' + note + '\n' + child.stdout + child.stderr)
  }
})
