import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Run the genuine scanner in an isolated synthetic repository, never the
// user's real M3 evidence folder or participant material.
const scanner = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const original = fileURLToPath(new URL('./' + scanner, import.meta.url))

function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-list-privacy-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3'), { recursive: true })
    copyFileSync(original, join(root, 'tests', scanner))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic only\n')
    writeFileSync(join(root, 'evidence', 'm3', 'note.md'), note + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scanner)], {
      cwd: root, env, encoding: 'utf8', timeout: 20000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null)
    assert.match(result.stdout + result.stderr,
      /QA M3: every committed Markdown evidence note forbids obvious personal identifiers/)
    return result
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, note] of [
  ['numbered-dot participant field', '1. participantName: synthetic-identifier'],
  ['numbered-close parenthesis account field', '2) account-id = synthetic-identifier'],
  ['nested numbered full-name field', '> 3. **Full Name**: Synthetic Label'],
  ['unchecked list item', '- [ ] participant_email: synthetic-label'],
  ['checked list item', '* [x] naam-deelnemer = synthetic-label'],
  ['fullwidth checkbox alias', '+ [X] ｐａｒｔｉｃｉｐａｎｔＮａｍｅ: synthetic-label'],
]) {
  test('QA M3 explicit identifiers in Markdown list: ' + label, () => {
    const result = scan(note)
    assert.equal(result.status, 1,
      'scanner accepted a fabricated direct identifier:\n' + note + '\n' + result.stdout + result.stderr)
    assert.match(result.stdout + result.stderr, /obvious participant identifier/)
  })
}

test('QA M3 list privacy backstop keeps legitimate task instructions and pseudonyms', () => {
  for (const note of [
    '1. Check that a pseudonymous participantKey is present.',
    '2) Never store a participant name or personal email address.',
    '- [x] studyId: synthetic-observation-week',
    '- [ ] participantKey: pseudo-001',
    '* [X] ingredient: Broccoli',
    '3. Store name: PLUS',
  ]) {
    const result = scan(note)
    assert.equal(result.status, 0,
      'safe task note falsely rejected:\n' + note + '\n' + result.stdout + result.stderr)
  }
})
