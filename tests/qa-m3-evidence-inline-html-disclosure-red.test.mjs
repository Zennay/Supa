import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent #1528 repro against the real scanner. All values are fictional.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))
function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-inline-html-red-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'nested'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Fictional test evidence only\n')
    const noteFile = join(root, 'evidence', 'm3', 'nested', 'note.md')
    writeFileSync(noteFile, note)
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null, 'child quality scanner must terminate')
    assert.equal(readFileSync(noteFile, 'utf8'), note, 'scan must not rewrite original note')
    return { status: result.status, log: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// In CommonMark these HTML inline elements visibly render an explicit identity
// field with a nonempty value, but the current narrow regex checks only plain
// field labels or selected table/definition-list markup.
const disclosures = [
  '- <strong>participant_name</strong>: invented-person',
  '> <code>account-id</code> = invented-account',
  '| <span>full name</span> | fictional-person |',
  '- <em>participant</em>_email: invented-contact',
  '<p><b>Naam deelnemer</b>: fictional-person</p>',
  '- <span>account</span>-email: invented-recipient',
]
for (const [index, note] of disclosures.entries()) {
  test('QA #1528: inline HTML rendered identity disclosure ' + (index + 1) + ' fails closed', () => {
    const result = scan(note)
    assert.equal(result.status, 1, 'unrecognized visible ID: ' + JSON.stringify(note) + '\n' + result.log)
    assert.match(result.log, /obvious participant identifier/)
  })
}

const benign = [
  '- <strong>ingredient name</strong>: broccoli',
  '| <span>store name</span> | PLUS |',
  '<p><b>Privacy rule</b>: never record participant names.</p>',
  '- <em>study</em>_id: invented-week',
  'participantKey: fictional-pseudonym',
  '- <span>unit</span>: g',
]
for (const [index, note] of benign.entries()) {
  test('QA #1528: unrelated rendered evidence control ' + (index + 1) + ' remains allowed', () => {
    const result = scan(note)
    assert.equal(result.status, 0, 'safe observation text rejected: ' + JSON.stringify(note) + '\n' + result.log)
  })
}
