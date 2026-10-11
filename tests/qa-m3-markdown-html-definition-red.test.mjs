import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent #1528 expected RED. Synthetic HTML inside disposable M3 Markdown
// notes only; never read actual participant data or edit real evidence.
const scanner = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const source = fileURLToPath(new URL('./' + scanner, import.meta.url))

function run(markdown) {
  const temp = mkdtempSync(join(tmpdir(), 'supa-m3-html-dl-red-'))
  try {
    mkdirSync(join(temp, 'tests'))
    mkdirSync(join(temp, 'evidence', 'm3'), { recursive: true })
    copyFileSync(source, join(temp, 'tests', scanner))
    writeFileSync(join(temp, 'evidence', 'm3', 'README.md'), '# Fake policy only\n')
    writeFileSync(join(temp, 'evidence', 'm3', 'note.md'), markdown + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const r = spawnSync(process.execPath, ['--test', join(temp, 'tests', scanner)], {
      cwd: temp, env, encoding: 'utf8', timeout: 20000,
    })
    assert.ifError(r.error)
    assert.notEqual(r.status, null)
    return { code: r.status, output: r.stdout + r.stderr }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

test('QA #1528: obvious M3 direct-ID values inside HTML definition lists must fail closed', () => {
  for (const markdown of [
    '<dl><dt>participant_name</dt><dd>synthetic-label</dd></dl>',
    '<dl>\n<dt>full-name</dt>\n<dd>synthetic-label</dd>\n</dl>',
    '<dt>account-id</dt><dd>synthetic-user-ref</dd>',
  ]) {
    const r = run(markdown)
    assert.equal(r.code, 1,
      'HTML definition-list direct identifier escaped scanner:\n' + markdown + '\n' + r.output)
    assert.match(r.output, /obvious participant identifier/)
  }
})

test('QA #1528: nested-markup and attributed HTML definition labels must also be scanned', () => {
  for (const markdown of [
    '<dt class="label"><strong>participant_email</strong></dt>\n<dd class="value">synthetic-label</dd>',
    '<dt data-test="field"><code>naam-deelnemer</code></dt>\n<dd>synthetic-label</dd>',
  ]) {
    const r = run(markdown)
    assert.equal(r.code, 1,
      'HTML marked definition-list label escaped scanner:\n' + markdown + '\n' + r.output)
    assert.match(r.output, /obvious participant identifier/)
  }
})

test('QA #1528: definition-list policy text, pseudonyms and ingredient labels remain valid', () => {
  for (const markdown of [
    '<dl><dt>ingredient-id</dt><dd>synthetic-food</dd></dl>',
    '<dl><dt>participantKey</dt><dd>synthetic-pseudonym</dd></dl>',
    '<dt>store-name</dt><dd>PLUS</dd>',
    '<dt>participant_name</dt><dd></dd>',
    'The label participant_name is forbidden in a direct-identifier field.',
  ]) {
    const r = run(markdown)
    assert.equal(r.code, 0,
      'benign definition-list metadata falsely rejected:\n' + markdown + '\n' + r.output)
  }
})
