import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Exercise the real staged scanner against synthetic disposable M3 notes.
const scanner = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const original = fileURLToPath(new URL('./' + scanner, import.meta.url))
function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-escaped-label-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3'), { recursive: true })
    copyFileSync(original, join(root, 'tests', scanner))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic evidence only\n')
    writeFileSync(join(root, 'evidence', 'm3', 'sample.md'), note + '\n')
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

for (const [label, note] of [
  ['escaped underscore alias', 'participant\\_name: synthetic-label'],
  ['escaped dash alias', 'account\\-id = synthetic-label'],
  ['escaped dot alias', 'full\\.name: synthetic-label'],
  ['escaped dash participant email', 'participant\\-email: synthetic-label'],
  ['escaped label in checkbox', '- [x] participant\\_name: synthetic-label'],
  ['escaped label in Markdown table', '| account\\_email | synthetic-label |'],
]) {
  test('QA M3 Markdown escaped direct ID alias: ' + label, () => {
    const result = scan(note)
    assert.equal(result.status, 1, 'synthetic identifier escaped:\n' + note + '\n' + result.stdout + result.stderr)
    assert.match(result.stdout + result.stderr, /obvious participant identifier/)
  })
}

test('QA M3 Markdown escaping preserves nonidentifying policy and pseudonymous controls', () => {
  for (const note of [
    'Explain how to write participant\\_name labels, without including any value.',
    'participantKey: student-pseudonymous-001',
    '- [x] store\\-name: PLUS',
    '1. ingredient\\_id: synthetic-ingredient-1',
    '| Field | Meaning |\n| participantKey | pseudonymous token |',
  ]) {
    const result = scan(note)
    assert.equal(result.status, 0, 'safe note rejected:\n' + note + '\n' + result.stdout + result.stderr)
  }
})
