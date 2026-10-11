import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent synthetic QA #1528 probe. HTML5's named &NewLine; entity
// displays a line break, but the privacy scanner currently preserves it.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))
function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-named-newline-red-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'nested'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic notes\n')
    const target = join(root, 'evidence', 'm3', 'nested', 'note.md')
    writeFileSync(target, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null)
    assert.equal(readFileSync(target, 'utf8'), note, 'original evidence bytes must remain unchanged')
    return { status: result.status, output: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, note] of [
  ['list participant name', '- participant&NewLine;name: imaginary'],
  ['blockquote account id', '> account&NewLine;id = fictional-ref'],
  ['table full name', '| full&NewLine;name | invented |'],
  ['quoted account email', '"account&NewLine;email": fake-address'],
  ['HTML definition term', '<dt>participant&NewLine;email</dt><dd>synthetic</dd>'],
  ['Dutch bold email label', '**e&NewLine;mail&NewLine;adres**: fictitious'],
]) {
  test('QA #1528 expected RED: named NewLine entity cannot hide ID - ' + label, () => {
    const actual = scan(note)
    assert.equal(actual.status, 1, 'scanner missed fictional direct ID ' + JSON.stringify(note) + '\n' + actual.output)
    assert.match(actual.output, /obvious participant identifier/)
  })
}

test('QA #1528 named newline probe retains safe evidence documentation', () => {
  for (const note of [
    '- product&NewLine;name: carrots',
    '| store&NewLine;id | PLUS |',
    '> grocery&NewLine;list = synthetic',
    '<dt>recipe&NewLine;name</dt><dd>Curry</dd>',
    'participantKey: anonymous-key-001',
    'No personal names, contact details or receipts are allowed.',
  ]) {
    const actual = scan(note)
    assert.equal(actual.status, 0, 'false positive on safe note ' + JSON.stringify(note) + '\n' + actual.output)
  }
})
