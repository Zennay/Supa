import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const scanner = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const original = fileURLToPath(new URL('./' + scanner, import.meta.url))
function run(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-esc-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3'), { recursive: true })
    copyFileSync(original, join(root, 'tests', scanner))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic M3 test only\n')
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
  ['escaped e-mail in an ordered list', '1. e\\-mail\\-adres: synthetic-label'],
  ['escaped full name in task list', '- [ ] full\\-name = synthetic-label'],
  ['quoted escaped participant label', '> "participant\\_email" = synthetic-label'],
  ['escaped account field in Markdown table', '| `account\\.id` | synthetic-label |'],
  ['escaped Dutch name in nested checkbox', '> 3) - [x] naam\\-deelnemer: synthetic-label'],
  ['width-normalized escaped label', '４. ｐａｒｔｉｃｉｐａｎｔ\\＿ｎａｍｅ = synthetic-label'],
]) {
  test('QA M3 independent escaped punctuation privacy acceptance: ' + label, () => {
    const child = run(note)
    assert.equal(child.status, 1, 'fabricated field identifier escaped actual scanner:\n' + note + '\n' + child.stdout + child.stderr)
    assert.match(child.stdout + child.stderr, /obvious participant identifier/)
  })
}

test('QA M3 independent escaped punctuation controls keep safe policy and shopping metadata', () => {
  for (const note of [
    '1. Explain that participant\\_name is a forbidden label, not a value.',
    '- [x] participantKey: synthetic-pseudonym',
    '> "study\\_id": synthetic-week',
    '| `ingredient\\.id` | synthetic-food |',
    '3) - [ ] store\\-name: PLUS',
  ]) {
    const child = run(note)
    assert.equal(child.status, 0, 'safe note falsely rejected:\n' + note + '\n' + child.stdout + child.stderr)
  }
})
