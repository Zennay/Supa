import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Synthetic QA #1737 continuation. This branch is EXPECTED RED only, never merge alone.
// Test the actual repository M3 Markdown privacy guard on disposable nested notes.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function checkNote(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-typographic-separators-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence/m3/fictional/nested'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence/m3/README.md'), '# Fictional QA notes\n')
    const note = join(root, 'evidence/m3/fictional/nested/note.md')
    writeFileSync(note, markdown, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null)
    assert.equal(readFileSync(note, 'utf8'), markdown, 'scanner must not rewrite evidence bytes')
    return { status: result.status, logs: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [description, markdown] of [
  ['U+2010 HYPHEN in participant-name list', '- participant\u2010name: invented-a'],
  ['U+2011 NON-BREAKING HYPHEN in account-id heading', '## account\u2011id = invented-b'],
  ['U+2012 FIGURE DASH in full-name table', '| full\u2012name | invented-c |'],
  ['U+2013 EN DASH in account-email quote', '> account\u2013email: invented-d'],
  ['U+2212 MINUS SIGN in email-address field', 'e\u2212mail\u2212address: invented-e'],
  ['U+2010 HYPHEN in HTML definition', '<dt>naam\u2010deelnemer</dt><dd>invented-f</dd>'],
]) {
  test('QA #1737 expected RED - visually explicit field: ' + description, () => {
    const result = checkNote(markdown)
    assert.equal(result.status, 1, 'fictional direct-ID field missed: ' + description + '\n' + result.logs)
    assert.match(result.logs, /obvious participant identifier/)
  })
}

test('QA #1737 controls: grocery/provenance/pseudonymous text remains valid', () => {
  for (const markdown of [
    '- product\u2010name: broccoli',
    '## store\u2011id = plus-fictional',
    '| recipe\u2012name | lentils |',
    '> grocery\u2013price: unknown',
    'ingredient\u2212unit: kg',
    '<dt>basket\u2010source</dt><dd>synthetic</dd>',
    'participantKey: anonymous-study-001',
    'Do not store names, phone numbers or email addresses in committed evidence.',
  ]) {
    const result = checkNote(markdown)
    assert.equal(result.status, 0, 'safe fixture rejected: ' + markdown + '\n' + result.logs)
  }
})
