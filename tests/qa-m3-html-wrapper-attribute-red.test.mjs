import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Run the REAL evidence scanner in a disposable repository with fabricated notes.
// This is an intentionally RED-only privacy backstop regression, not a real leak.
const scanner = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const original = fileURLToPath(new URL('./' + scanner, import.meta.url))

function inspect(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-html-attributes-'))
  try {
    const tests = join(root, 'tests')
    const evidence = join(root, 'evidence', 'm3')
    mkdirSync(tests, { recursive: true })
    mkdirSync(evidence, { recursive: true })
    copyFileSync(original, join(tests, scanner))
    writeFileSync(join(evidence, 'README.md'), '# Controlled synthetic evidence only\n')
    writeFileSync(join(evidence, 'note.md'), note + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(tests, scanner)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null, child.stderr)
    assert.match(child.stdout + child.stderr,
      /QA M3: every committed Markdown evidence note forbids obvious personal identifiers/)
    return child
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [description, note] of [
  ['strong class attribute', '<tr><th><strong class="heading">participant-name</strong></th><td>Fabricated Value</td></tr>'],
  ['code data attribute', '<tr><td><code data-kind="field">account_id</code></td><td>synthetic-id</td></tr>'],
  ['bold title attribute', '<tr><th><b title="column">naam deelnemer</b></th><td>Fabricated Value</td></tr>'],
  ['paired strong role attribute', '<tr><td><strong role="heading">participantEmail</strong></td><td>synthetic-value</td></tr>'],
]) {
  test('QA M3 refuses synthetic HTML direct-ID cell with ' + description, () => {
    const result = inspect(note)
    assert.equal(result.status, 1,
      'formatted direct-ID field escaped guard: ' + note + '\n' + result.stdout + result.stderr)
    assert.match(result.stdout + result.stderr, /obvious participant identifier/)
  })
}

test('QA M3 still accepts non-PII formatted cells and explanatory policy prose', () => {
  for (const note of [
    '<tr><th><strong class="heading">participantKey</strong></th><td>pseudonym-007</td></tr>',
    '<tr><td><code data-kind="field">studyId</code></td><td>week-1</td></tr>',
    '<tr><td><b title="column">Product name</b></td><td>Broccoli</td></tr>',
    '<tr><td><strong role="heading">Store name</strong></td><td>PLUS</td></tr>',
    '<p>Privacy policy: never store participant names or participant emails.</p>',
  ]) {
    const result = inspect(note)
    assert.equal(result.status, 0,
      'benign note unexpectedly refused: ' + note + '\n' + result.stdout + result.stderr)
  }
})
