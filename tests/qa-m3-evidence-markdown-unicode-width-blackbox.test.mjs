import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Add-only synthetic black-box check of the *actual* M3 Markdown evidence
// scanner: no actual participant or retailer evidence is read or modified.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scannerPath = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-unicode-label-'))
  try {
    const testDir = join(root, 'tests')
    const evidenceDir = join(root, 'evidence', 'm3')
    mkdirSync(testDir, { recursive: true })
    mkdirSync(evidenceDir, { recursive: true })
    copyFileSync(scannerPath, join(testDir, scannerName))
    writeFileSync(join(evidenceDir, 'README.md'), '# Synthetic identifier safety contract\n')
    writeFileSync(join(evidenceDir, 'untrusted-note.md'), note, 'utf8')
    const env = { ...process.env }
    // Required for nested node:test: otherwise child tests may be skipped.
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(testDir, scannerName)], {
      env, encoding: 'utf8', timeout: 20000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null, 'scanner process must exit')
    assert.match(child.stdout + child.stderr, /QA M3: every committed Markdown evidence note/)
    return child
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const unsafeCases = [
  ['fullwidth participant-name bare field', 'ｐａｒｔｉｃｉｐａｎｔＮａｍｅ: synthetic-only-value'],
  ['fullwidth account-id label', 'ａｃｃｏｕｎｔ＿ｉｄ: synthetic-only-value'],
  ['fullwidth full-name Markdown field', '**ＦｕｌｌＮａｍｅ**: Synthetic Student'],
  ['fullwidth email-address JSON-like field', '    "ｅｍａｉｌ＿ａｄｄｒｅｓｓ": "synthetic-only-value"'],
  ['fullwidth participant email table key', '| ｐａｒｔｉｃｉｐａｎｔＥｍａｉｌ | synthetic-only-value |'],
]

for (const [label, note] of unsafeCases) {
  test('QA M3 privacy scanner rejects ' + label, () => {
    // NFKC is a scope-limited Unicode width compatibility oracle.
    // Generic confusables, unlabelled natural-language names and PII
    // classification remain explicitly OUTSIDE the scanner's contract.
    assert.match(note.normalize('NFKC').toLowerCase(),
      /participantname|account_id|fullname|email_address|participantemail/)
    const child = scan(note + '\n')
    assert.equal(child.status, 1,
      'The canonical Markdown evidence privacy guard admitted a visually ' +
      'recognizable direct-identifier label after Unicode width folding.\n' +
      'stdout:\n' + child.stdout + '\nstderr:\n' + child.stderr)
    assert.match(child.stdout + child.stderr, /obvious participant identifier/)
  })
}

test('QA M3 privacy scanner permits Unicode pseudonymous labels and descriptive prose', () => {
  for (const note of [
    'ｐａｒｔｉｃｉｐａｎｔＫｅｙ: synthetic-pseudonym-001',
    '**ＳｔｕｄｙＩｄ**: synthetic-m3-only',
    '# Privacy contract\nDo not commit full names, participant names, receipts or email addresses.',
  ]) {
    const child = scan(note + '\n')
    assert.equal(child.status, 0, child.stdout + '\n' + child.stderr)
  }
})
