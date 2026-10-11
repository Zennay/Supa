import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent postrepair reference-link QA, no real M3 participants or receipts.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function inspect(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-ref-link-postrepair-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'review-1'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic evidence\n')
    const path = join(root, 'evidence', 'm3', 'review-1', 'note.md')
    writeFileSync(path, note)
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null)
    assert.equal(readFileSync(path, 'utf8'), note, 'M3 evidence must stay byte-for-byte untouched')
    return { status: result.status, log: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('QA #1528: independently block visible identity field labels behind Markdown reference links', () => {
  for (const note of [
    '- [full.name][label] : fictitious-student\n\n[label]: #identity',
    '3) [account_email][account]: fictional-contact\n\n[account]: https://example.invalid/',
    '> | [participant-name][ref] | synthetic-value |\n\n[ref]: #note',
    '- [e-mail-adres][] = invented-contact\n\n[e-mail-adres]: #contact',
    '> **[account-id][ledger]**: fake-reference\n\n[ledger]: #account',
  ]) {
    const result = inspect(note)
    assert.equal(result.status, 1, 'reference link evaded bounded ID scan: ' + JSON.stringify(note) + '\n' + result.log)
    assert.match(result.log, /obvious participant identifier/)
  }
})

test('QA #1528: preserve real link destination scanning, policies and benign pseudonyms', () => {
  for (const note of [
    '[Contact](mailto:invented@example.test)',
    '> [Sample](https://example.invalid/invented@example.test)',
  ]) {
    const result = inspect(note)
    assert.equal(result.status, 1, 'link target email evaded scanner: ' + JSON.stringify(note) + '\n' + result.log)
    assert.match(result.log, /obvious participant identifier/)
  }
  for (const note of [
    '- [studyId][run]: week-fictional\n\n[run]: #metadata',
    '| [ingredient name][food] | broccoli |\n\n[food]: #food',
    '[participantKey][] = synthetic-anonymous-key\n\n[participantKey]: #safe',
    'Avoid including [full name][policy] in evidence.\n\n[policy]: #guidance',
    '- [store name][shop]: PLUS\n\n[shop]: #provenance',
  ]) {
    const result = inspect(note)
    assert.equal(result.status, 0, 'safe linked field rejected: ' + JSON.stringify(note) + '\n' + result.log)
  }
})
