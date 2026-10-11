import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// M3 direct-identifier tables can appear inside ordinary Markdown quote/list
// formatting. Execute the REAL scanner against disposable synthetic evidence.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scannerPath = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-quoted-table-'))
  try {
    const testsDir = join(root, 'tests')
    const evidenceDir = join(root, 'evidence', 'm3')
    mkdirSync(testsDir, { recursive: true })
    mkdirSync(evidenceDir, { recursive: true })
    copyFileSync(scannerPath, join(testsDir, scannerName))
    writeFileSync(join(evidenceDir, 'README.md'), '# Synthetic observations only\n')
    writeFileSync(join(evidenceDir, 'case.md'), note + '\n')
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

const unsafeTables = [
  ['single quote', '> | participantName | synthetic-value |'],
  ['nested quote', '> > | account-id | synthetic-value |'],
  ['list table row', '- | **Full Name** | Synthetic Student |'],
  ['quoted list table row', '> - | Participant Email | synthetic-value |'],
]

for (const [label, note] of unsafeTables) {
  test('QA M3 privacy table rejects explicit direct IDs inside ' + label, () => {
    const child = scan(note)
    assert.equal(child.status, 1,
      'synthetic direct-ID table escaped real privacy guard:\n' + note +
      '\n' + child.stdout + '\n' + child.stderr)
    assert.match(child.stdout + child.stderr, /obvious participant identifier/)
  })
}

test('QA M3 quoted tables retain normal metadata, store/products and policy prose', () => {
  for (const note of [
    '> | participantKey | pseudonym-001 |',
    '> > | Store name | PLUS |',
    '- | Product name | Broccoli |',
    '> - | Field | Meaning |',
    '> | studyId | synthetic-week |',
  ]) {
    const child = scan(note)
    assert.equal(child.status, 0,
      'benign quoted table was incorrectly rejected:\n' + note +
      '\n' + child.stdout + '\n' + child.stderr)
  }
})
