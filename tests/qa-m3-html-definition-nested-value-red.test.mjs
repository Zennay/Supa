import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent #1528 expected-RED: text-visible direct IDs in a simple HTML
// definition-list value wrapper. Disposable synthetic Markdown only.
const scanner = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const source = fileURLToPath(new URL('./' + scanner, import.meta.url))

function scan(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-nested-dd-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3'), { recursive: true })
    copyFileSync(source, join(root, 'tests', scanner))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic policy only\n')
    writeFileSync(join(root, 'evidence', 'm3', 'note.md'), markdown + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scanner)], {
      cwd: root, env, encoding: 'utf8', timeout: 20000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null)
    return { status: result.status, log: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('QA #1528 RED: visible direct-ID values in one HTML dd formatting wrapper must be rejected', () => {
  for (const note of [
    '<dl><dt>participant_name</dt><dd><span>synthetic-label</span></dd></dl>',
    '<dt>account-email</dt><dd class="v"><code>synthetic-value</code></dd>',
    '<dt>full_name</dt><dd><strong>synthetic-label</strong></dd>',
    '<dt>naam-deelnemer</dt><dd>\n<em>synthetic-label</em>\n</dd>',
  ]) {
    const result = scan(note)
    assert.equal(result.status, 1,
      'Visible formatted direct identifier escaped guard:\n' + note + '\n' + result.log)
    assert.match(result.log, /obvious participant identifier/)
  }
})

test('QA #1528 RED controls: empty formatted values and safe metadata stay allowed', () => {
  for (const note of [
    '<dt>participant_name</dt><dd><span></span></dd>',
    '<dt>participant_name</dt><dd><strong>   </strong></dd>',
    '<dt>participantKey</dt><dd><span>synthetic-key</span></dd>',
    '<dt>ingredient-name</dt><dd><span>Broccoli</span></dd>',
    'We forbid participant_name fields containing any private user data.',
  ]) {
    const result = scan(note)
    assert.equal(result.status, 0,
      'Legitimate or empty definition value was rejected:\n' + note + '\n' + result.log)
  }
})
