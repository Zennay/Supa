import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Synthetic, independent black-box reproduction of HTML cell formatting bypass.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scannerPath = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function runScanner(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-html-cell-privacy-'))
  try {
    const testsDir = join(root, 'tests')
    const evidenceDir = join(root, 'evidence', 'm3')
    mkdirSync(testsDir, { recursive: true })
    mkdirSync(evidenceDir, { recursive: true })
    copyFileSync(scannerPath, join(testsDir, scannerName))
    writeFileSync(join(evidenceDir, 'README.md'), '# Synthetic M3 evidence only\n')
    writeFileSync(join(evidenceDir, 'note.md'), note + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(testsDir, scannerName)], {
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

const forbidden = [
  ['bold header', '<tr><th><strong>participantName</strong></th><td>Synthetic Student</td></tr>'],
  ['inline-code account ID', '<tr><td><code>accountId</code></td><td>synthetic-value</td></tr>'],
  ['short bold full name', '<tr><td><b>Full Name</b></td><td>Synthetic Student</td></tr>'],
  ['strong participant email', '<tr><th><strong>participant_email</strong></th><td>synthetic-value</td></tr>'],
  ['fullwidth account label in code tag', '<tr><td><code>ａｃｃｏｕｎｔ－ｉｄ</code></td><td>synthetic-value</td></tr>'],
]

for (const [description, note] of forbidden) {
  test('QA M3 HTML cell privacy rejects ' + description, () => {
    const child = runScanner(note)
    assert.equal(child.status, 1,
      'synthetic labelled direct ID escaped real guard:\n' + note + '\n' + child.stdout + child.stderr)
    assert.match(child.stdout + child.stderr, /obvious participant identifier/)
  })
}

test('QA M3 HTML cell privacy preserves unlabelled and pseudonymous cells', () => {
  for (const note of [
    '<tr><th><strong>participantKey</strong></th><td>pseudonym</td></tr>',
    '<tr><td><code>studyId</code></td><td>synthetic-week</td></tr>',
    '<tr><td><b>Product name</b></td><td>Broccoli</td></tr>',
    '<tr><td><strong>Store name</strong></td><td>PLUS</td></tr>',
    '<p>Never put participant names or personal account details in evidence.</p>',
  ]) {
    const child = runScanner(note)
    assert.equal(child.status, 0,
      'benign HTML should remain permitted:\n' + note + '\n' + child.stdout + child.stderr)
  }
})
