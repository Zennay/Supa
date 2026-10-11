import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent acceptance of the REAL M3 evidence scanner, disposable synthetic data.
const scanner = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const original = fileURLToPath(new URL('./' + scanner, import.meta.url))
function run(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-qa-multiline-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3'), { recursive: true })
    copyFileSync(original, join(root, 'tests', scanner))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic evidence only\n')
    writeFileSync(join(root, 'evidence', 'm3', 'note.md'), note + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', scanner)], {
      cwd: root, env, encoding: 'utf8', timeout: 20000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    assert.match(child.stdout + child.stderr,
      /QA M3: every committed Markdown evidence note forbids obvious personal identifiers/)
    return child
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, value] of [
  ['nested multi-line Dutch alias', '<!--\n  naam-deelnemer: fabricated-label\n  explanatory detail\n-->'],
  ['fullwidth labelled participant metadata', '<!-- ｐａｒｔｉｃｉｐａｎｔＮａｍｅ: fabricated-label\n-->'],
  ['explicit account email without address literal', '<!-- account_email = synthetic-label\n  more detail\n-->'],
  ['upper-case line with Windows newline', '<!-- PARTICIPANT-EMAIL: synthetic-value\r\n-->'],
]) {
  test('QA M3 multiline HTML comment rejects ' + label, () => {
    const child = run(value)
    assert.equal(child.status, 1,
      'synthetic labelled value escaped:\n' + value + '\n' + child.stdout + child.stderr)
    assert.match(child.stdout + child.stderr, /obvious participant identifier/)
  })
}

test('QA M3 multiline HTML comment preserves pseudonym and public notes', () => {
  for (const note of [
    '<!-- participantKey: pseudo-001\n region: Leiden\n-->',
    '<!-- store name: PLUS\n ingredient: Broccoli\n-->',
    '<!-- studyId: synthetic-week\n status: collection-template-not-evidence\n-->',
    '<!-- Source policy\n never record a real name, email address or account identifier\n-->',
  ]) {
    const child = run(note)
    assert.equal(child.status, 0,
      'safe note rejected:\n' + note + '\n' + child.stdout + child.stderr)
  }
})
