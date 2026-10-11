import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent ADD-ONLY synthetic repro on the real canonical Markdown scanner.
// Heading markers are Markdown presentation syntax, not part of a field name.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scannerPath = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-heading-field-'))
  try {
    const testDir = join(root, 'tests')
    const evidenceDir = join(root, 'evidence', 'm3')
    mkdirSync(testDir, { recursive: true })
    mkdirSync(evidenceDir, { recursive: true })
    copyFileSync(scannerPath, join(testDir, scannerName))
    writeFileSync(join(evidenceDir, 'README.md'), '# Synthetic M3 evidence\n')
    writeFileSync(join(evidenceDir, 'case.md'), note + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT // Prevent child node:test from silently skipping tests.
    const child = spawnSync(process.execPath, ['--test', join(testDir, scannerName)], {
      env, encoding: 'utf8', timeout: 20000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null, 'child scanner exited')
    assert.match(child.stdout + child.stderr,
      /QA M3: every committed Markdown evidence note forbids obvious personal identifiers/)
    return child
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const forbidden = [
  ['level-one participant name', '# participantName: synthetic-only-value'],
  ['level-two participant email', '## Participant Email: synthetic-only-value'],
  ['level-three bold full name', '### **Full Name**: Synthetic Student'],
  ['level-four account ID', '#### account-id = synthetic-only-value'],
  ['level-five quoted field', '##### "email_address": "synthetic-only-value"'],
]

for (const [label, note] of forbidden) {
  test('QA M3 heading privacy rejects ' + label, () => {
    const child = scan(note)
    assert.equal(child.status, 1,
      'Direct identifier label in Markdown heading escaped the real scanner:\n' +
      note + '\n' + child.stdout + '\n' + child.stderr)
    assert.match(child.stdout + child.stderr, /obvious participant identifier/)
  })
}

test('QA M3 heading privacy permits headings, pseudonyms and explanatory policy', () => {
  for (const note of [
    '# M3 privacy contract\nDo not commit full names or participant emails.',
    '## participantKey: synthetic-pseudonym-only',
    '### studyId: synthetic-m3-week',
    '#### Product name: Broccoli',
    '##### Store name: PLUS',
  ]) {
    const child = scan(note)
    assert.equal(child.status, 0, note + '\n' + child.stdout + '\n' + child.stderr)
  }
})
