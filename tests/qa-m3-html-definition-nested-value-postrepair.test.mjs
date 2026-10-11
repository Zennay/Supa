import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Add-only independent postrepair acceptance of #1528's bounded Markdown
// direct-identifier guard. All data is fabricated in throwaway directories.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scannerPath = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function runActualGuard(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-dd-postrepair-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3'), { recursive: true })
    copyFileSync(scannerPath, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Only synthetic acceptance data\n')
    writeFileSync(join(root, 'evidence', 'm3', 'synthetic.md'), note + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const out = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20000,
    })
    assert.ifError(out.error)
    assert.notEqual(out.status, null)
    return { status: out.status, output: out.stdout + out.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('QA #1528: formatted visible HTML definition-list identifiers fail closed after repair', () => {
  const cases = [
    '<dt>participant-name</dt><dd><span data-test="v">fake-label</span></dd>',
    '<dt>FULL_NAME</dt><dd><strong>fake-reference</strong></dd>',
    '<dt>account_id</dt><dd><b>fake-account</b></dd>',
    '<dt>participant\\_email</dt><dd><code>fake-address</code></dd>',
    '<dt>naam-deelnemer</dt><dd>\n<em class="field-value">fake-person</em>\n</dd>',
    '<dt>ｅｍａｉｌ-ａｄｒｅｓ</dt><dd><span>fake-address</span></dd>',
    '<dt><strong>participant_name</strong></dt><dd><code>fake-person</code></dd>',
    '<dl><dt>account-email</dt><dd><SPAN class="value">fake-email-label</SPAN></dd></dl>',
  ]
  for (const note of cases) {
    const r = runActualGuard(note)
    assert.equal(r.status, 1, 'Visible direct identifier was accepted:\n' + note + '\n' + r.output)
    assert.match(r.output, /obvious participant identifier/, note)
  }
})

test('QA #1528: benign wrapped values and empty fields are accepted after repair', () => {
  const controls = [
    '<dt>participant_name</dt><dd><span></span></dd>',
    '<dt>participant_name</dt><dd><b>    </b></dd>',
    '<dt>participant_name</dt><dd>\n<em>\n </em>\n</dd>',
    '<dt>participantKey</dt><dd><code>pseudonymous-key</code></dd>',
    '<dt>studyId</dt><dd><strong>synthetic-study</strong></dd>',
    '<dt>ingredient-name</dt><dd><span>Broccoli</span></dd>',
    '<dt>store-name</dt><dd><span>PLUS</span></dd>',
    'The phrase participant_name documents a prohibited field, not a private value.',
  ]
  for (const note of controls) {
    const r = runActualGuard(note)
    assert.equal(r.status, 0, 'Legitimate Markdown falsely rejected:\n' + note + '\n' + r.output)
  }
})
