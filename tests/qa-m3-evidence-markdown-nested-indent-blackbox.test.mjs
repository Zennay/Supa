import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent exact-scanner black-box acceptance on a synthetic temporary repo.
// This test never modifies committed participant or retailer evidence.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function runScanner(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-nested-label-'))
  try {
    const tests = join(root, 'tests')
    const evidence = join(root, 'evidence', 'm3')
    mkdirSync(tests, { recursive: true })
    mkdirSync(evidence, { recursive: true })
    copyFileSync(scanner, join(tests, scannerName))
    writeFileSync(join(evidence, 'README.md'), '# Synthetic QA privacy fixture\n')
    writeFileSync(join(evidence, 'nested-note.md'), markdown)
    const env = { ...process.env }
    // Without this removal, nested node --test silently skips the child tests.
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(tests, scannerName)], {
      encoding: 'utf8', timeout: 20000, env,
    })
    assert.ifError(child.error)
    return child
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const unsafeCases = [
  ['JSON: four-space nested quoted participant name',
    '```json\n{\n  "record": {\n    "participantName": "Synthetic Student"\n  }\n}\n```\n'],
  ['YAML: six-space nested underscored participant email (no actual address)',
    '```yaml\nrecord:\n  entry:\n      participant_email: synthetic-name-only\n```\n'],
  ['YAML: eight-space account identifier alias',
    '```yaml\nrecord:\n  entry:\n        account-id: synthetic-account-only\n```\n'],
  ['Markdown: four-space nested bold full name',
    '    **fullName**: Synthetic Student\n'],
  ['Markdown: seven-space nested quoted account-email key',
    '- audit:\n       "accountEmail": "synthetic-account"\n'],
]

for (const [name, note] of unsafeCases) {
  test('QA nested M3 note rejects ' + name, () => {
    const child = runScanner(note)
    assert.equal(child.status, 1,
      'Real M3 Markdown scanner accepted obvious nested direct-identifier label.\n' +
      'stdout:\n' + child.stdout + '\nstderr:\n' + child.stderr)
    assert.match(child.stdout + child.stderr, /obvious participant identifier/)
  })
}

test('QA nested M3 scanner still accepts deeply indented pseudonyms and policy prose', () => {
  for (const note of [
    '    participantKey: synthetic-pseudonym-001\n    studyId: week-example\n',
    '```yaml\nrecord:\n      notes: "Do not commit participant names, email addresses or receipts."\n```\n',
    '        - Product name: Broccoli\n        - Store name: PLUS\n',
  ]) {
    const child = runScanner(note)
    assert.equal(child.status, 0, child.stdout + '\n' + child.stderr)
  }
})
