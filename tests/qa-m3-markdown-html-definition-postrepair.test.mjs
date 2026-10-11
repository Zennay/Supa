import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent #1528 postrepair coverage; real scanner, synthetic Markdown
// files in throwaway directories, no personal information or live M3 evidence.
const scanner = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const source = fileURLToPath(new URL('./' + scanner, import.meta.url))

function verify(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-dl-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3'), { recursive: true })
    copyFileSync(source, join(root, 'tests', scanner))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic policy only\n')
    writeFileSync(join(root, 'evidence', 'm3', 'example.md'), markdown + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const r = spawnSync(process.execPath, ['--test', join(root, 'tests', scanner)], {
      cwd: root, env, encoding: 'utf8', timeout: 20000,
    })
    assert.ifError(r.error)
    assert.notEqual(r.status, null)
    return { status: r.status, output: r.stdout + r.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('QA #1528: postrepair catches HTML definition fields across wrappers and spacing', () => {
  for (const markdown of [
    '<dl><dt><b>participant-name</b></dt><dd>synthetic-label</dd></dl>',
    '<dl>\n<dt><code>full_name</code></dt>\n<dd>synthetic-value</dd>\n</dl>',
    '<dt class="field">account_email</dt><dd class="value">synthetic-reference</dd>',
    '<dt>naam-deelnemer</dt>\n\n<dd>synthetic-label</dd>',
    '<dt>e-mail-adres</dt><dd>synthetic-address</dd>',
  ]) {
    const r = verify(markdown)
    assert.equal(r.status, 1, 'explicit direct ID escaped:\n' + markdown + '\n' + r.output)
    assert.match(r.output, /obvious participant identifier/)
  }
})

test('QA #1528: reject normalized field aliases without interpreting unrelated prose', () => {
  for (const markdown of [
    '<dt>Ｆｕｌｌ＿Ｎａｍｅ</dt><dd>synthetic-label</dd>',
    '<dt>participant\\_email</dt><dd>synthetic-label</dd>',
  ]) {
    const r = verify(markdown)
    assert.equal(r.status, 1, 'normalized direct ID escaped:\n' + markdown + '\n' + r.output)
    assert.match(r.output, /obvious participant identifier/)
  }
})

test('QA #1528: preserve empty values, benign policy and pseudonymous metadata', () => {
  for (const markdown of [
    '<dt>participant_name</dt><dd></dd>',
    '<dt>participant_name</dt><dd>   </dd>',
    '<dt>studyId</dt><dd>synthetic-week</dd>',
    '<dt>participantKey</dt><dd>synthetic-pseudonym</dd>',
    '<dl><dt><b>ingredient-id</b></dt><dd>synthetic-food</dd></dl>',
    '<dt>product-name</dt><dd>Broccoli</dd>',
    'Document why participant_name fields cannot contain values.',
  ]) {
    const r = verify(markdown)
    assert.equal(r.status, 0, 'benign HTML note overblocked:\n' + markdown + '\n' + r.output)
  }
})
