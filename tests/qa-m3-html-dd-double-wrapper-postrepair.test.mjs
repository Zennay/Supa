import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent add-only acceptance of the *actual* staged QA guard following
// its bounded two-wrapper repair; never substitutes for genuine M3 field data.
const scanner = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scannerFile = fileURLToPath(new URL('./' + scanner, import.meta.url))

function assessSyntheticMarkdown(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-double-wrap-postrepair-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3'), { recursive: true })
    copyFileSync(scannerFile, join(root, 'tests', scanner))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic only\n')
    writeFileSync(join(root, 'evidence', 'm3', 'check.md'), markdown + '\n')
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

test('QA #1528 postrepair: double wrapped direct-ID values reject independent HTML variations', () => {
  for (const sample of [
    '<dl><dt>Full_Name</dt><dd class="v"><span id="x"><em>example-person</em></span></dd></dl>',
    '<dt>ACCOUNT-ID</dt>\n<dd>\n<strong><code>example-account</code></strong>\n</dd>',
    '<dt>participant_email</dt><dd><SPAN class="one"><B class="two">example-value</B></SPAN></dd>',
    '<dt><code>naam-deelnemer</code></dt><dd><em><strong>example-value</strong></em></dd>',
    '<dt>ｅｍａｉｌ-ａｄｒｅｓ</dt><dd><b><span>example-value</span></b></dd>',
  ]) {
    const r = assessSyntheticMarkdown(sample)
    assert.equal(r.status, 1, 'Nested visible value escaped guard:\n' + sample + '\n' + r.output)
    assert.match(r.output, /obvious participant identifier/, sample)
  }
})

test('QA #1528 postrepair: double-wrapper and adjacent policy controls do not create false alarms', () => {
  for (const sample of [
    '<dt>full_name</dt><dd><strong><code></code></strong></dd>',
    '<dt>account_id</dt><dd><em><span> \n </span></em></dd>',
    '<dt>participant_email</dt><dd><span><b>\n</b></span></dd>',
    '<dt>participantKey</dt><dd><span><b>pseudonymous-study-key</b></span></dd>',
    '<dt>studyId</dt><dd><span><em>test-study-001</em></span></dd>',
    '<dt>ingredient-name</dt><dd><strong><em>Broccoli</em></strong></dd>',
    '<dt>store-name</dt><dd><span><code>DekaMarkt</code></span></dd>',
    'The field participant_name must not be committed as personally identifying evidence.',
  ]) {
    const r = assessSyntheticMarkdown(sample)
    assert.equal(r.status, 0, 'Benign synthetic note was rejected:\n' + sample + '\n' + r.output)
  }
})
