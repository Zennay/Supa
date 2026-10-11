import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent expected-RED QA #1528: nested *visible* HTML values in a
// disposable synthetic M3 Markdown repository. No participant/retailer data.
const scanner = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scannerFile = fileURLToPath(new URL('./' + scanner, import.meta.url))

function runGuard(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-qa-dd-nested-red-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3'), { recursive: true })
    copyFileSync(scannerFile, join(root, 'tests', scanner))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic privacy QA\n')
    writeFileSync(join(root, 'evidence', 'm3', 'example.md'), note + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const res = spawnSync(process.execPath, ['--test', join(root, 'tests', scanner)], {
      cwd: root, env, encoding: 'utf8', timeout: 20000,
    })
    assert.ifError(res.error)
    assert.notEqual(res.status, null)
    return { status: res.status, text: res.stdout + res.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('QA #1528: two nested visible HTML value wrappers cannot conceal explicit direct-ID fields', () => {
  for (const note of [
    '<dt>participant_name</dt><dd><span><strong>synthetic-person</strong></span></dd>',
    '<dt>account_id</dt><dd><em class="v"><code>synthetic-account</code></em></dd>',
    '<dt>naam-deelnemer</dt><dd><b><span class="v">synthetic-label</span></b></dd>',
    '<dt><strong>participant_email</strong></dt><dd><span>\n<strong>synthetic-label</strong></span></dd>',
  ]) {
    const result = runGuard(note)
    assert.equal(result.status, 1, 'Visible nested field bypassed privacy scanner:\n' + note + '\n' + result.text)
    assert.match(result.text, /obvious participant identifier/, note)
  }
})

test('QA #1528: nested empty and pseudonymous metadata remain permitted', () => {
  for (const note of [
    '<dt>participant_name</dt><dd><span><strong></strong></span></dd>',
    '<dt>participant_name</dt><dd><span> <strong> </strong></span></dd>',
    '<dt>participantKey</dt><dd><span><strong>pseudonymous-key</strong></span></dd>',
    '<dt>ingredient-name</dt><dd><em><code>Broccoli</code></em></dd>',
    '<dt>store-name</dt><dd><span><b>PLUS</b></span></dd>',
  ]) {
    const result = runGuard(note)
    assert.equal(result.status, 0, 'Benign HTML wrongly rejected:\n' + note + '\n' + result.text)
  }
})
