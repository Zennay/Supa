import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Expected RED on frozen postrepair #1709. All identities are fictional.
// The actual QA #1528 scanner is tested with disposable nested M3 notes.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))
function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-wbr-invisible-qa-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'nested'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Fictional evidence policy\n')
    const path = join(root, 'evidence', 'm3', 'nested', 'note.md')
    writeFileSync(path, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    assert.equal(readFileSync(path, 'utf8'), note, 'scanner must never rewrite source evidence')
    return { code: child.status, output: child.stdout + child.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// HTML wbr renders no visible character; numeric references below render
// invisible Unicode controls that the existing raw-byte scrub already strips.
for (const [label, note] of [
  ['word-break inside name field', '- participant<wbr>_name: fictional-student'],
  ['word-break inside account field', '> account<wbr class="soft-break">-id = invented-value'],
  ['word-break in recipient', 'Contact: imaginary@exam<wbr>ple.test'],
  ['decimal zero-width break', 'full&#8203; name: synthetic-student'],
  ['hex zero-width joiner', '- account&#x200D;_email: fake-address'],
  ['decimal BOM inside recipient', 'Contact: synthetic@examp&#65279;le.test'],
]) {
  test('QA #1528 rejects visually joined identifier: ' + label, () => {
    const actual = scan(note)
    assert.equal(actual.code, 1, 'missed fictional disclosure ' + JSON.stringify(note) + '\n' + actual.output)
    assert.match(actual.output, /obvious participant identifier/)
  })
}

test('QA #1528 leaves benign word-breaks, store metadata and policy notes allowed', () => {
  for (const note of [
    '- ingredient<wbr>_name: tomato',
    'Store: PLUS<wbr> supermarket',
    'Never retain participant<wbr>_name in notes.',
    'Policy: account&#8203;_id is forbidden in evidence.',
    'participantKey: example-pseudonym',
    'Shopping list: 2 x courgette&#8203;soep',
  ]) {
    const actual = scan(note)
    assert.equal(actual.code, 0, 'benign note falsely rejected ' + JSON.stringify(note) + '\n' + actual.output)
  }
})
