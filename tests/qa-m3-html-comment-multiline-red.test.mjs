import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Controlled synthetic HTML comment coverage; run the actual M3 scanner in
// a disposable repository, never inspect or write real participant evidence.
const scanner = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const original = fileURLToPath(new URL('./' + scanner, import.meta.url))

function check(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-qa-html-comment-'))
  try {
    mkdirSync(join(root, 'tests'), { recursive: true })
    mkdirSync(join(root, 'evidence', 'm3'), { recursive: true })
    copyFileSync(original, join(root, 'tests', scanner))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic controls only\n')
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
  ['trailing explanatory line', '<!-- participantName: fabricated-value\n additional note -->'],
  ['closing marker on next line', '<!-- account_id = synthetic-value\n-->'],
  ['nested comment content', '<!-- email_address: fake-field-value\n never commit this field -->'],
]) {
  test('QA M3 rejects synthetic HTML comment direct-ID ' + label, () => {
    const result = check(note)
    assert.equal(result.status, 1,
      'direct-ID HTML comment escaped real scanner:\n' + note + '\n' + result.stdout + result.stderr)
    assert.match(result.stdout + result.stderr, /obvious participant identifier/)
  })
}

test('QA M3 leaves pseudonymous and explanatory multiline comments alone', () => {
  for (const note of [
    '<!-- participantKey: pseudo-001\n studyId: m3-week -->',
    '<!-- Store name: PLUS\n Product name: Broccoli -->',
    '<!-- Privacy policy:\n direct names and contact data are prohibited -->',
    '<!-- Untouched comment describing the observation window\n 24-hour maximum -->',
  ]) {
    const result = check(note)
    assert.equal(result.status, 0,
      'benign comment rejected:\n' + note + '\n' + result.stdout + result.stderr)
  }
})
