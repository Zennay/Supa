import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent add-only postrepair QA acceptance for #1528.
// Fictitious identifiers and throwaway evidence only. Never alter real notes.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function runScanner(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-control-space-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'nested', 'accept'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic M3 contract\n')
    const notePath = join(root, 'evidence', 'm3', 'nested', 'accept', 'week.md')
    writeFileSync(notePath, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null)
    assert.equal(readFileSync(notePath, 'utf8'), note, 'no changes to original evidence bytes')
    return { status: result.status, output: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, note] of [
  ['zero-padded hex TAB within emphasised field', '- **participant&#x0009;email** = fictional'],
  ['decimal LF within blockquoted quoted field', '> "full&#00010;name": synthetic'],
  ['uppercase hex CR in Markdown table', '| account&#XD;id | imaginary-key |'],
  ['hex TAB within HTML definition term', '<dt>account&#x9;email</dt><dd>fictional-id</dd>'],
  ['decimal LF within HTML table cell', '<td>participant&#10;name</td><td>imaginary</td>'],
  ['mixed CR and TAB within Dutch list field', '3. e&#x0D;mail&#x09;adres = made-up-contact'],
]) {
  test('QA #1528 independent acceptance refuses numeric HTML control-space direct ID: ' + label, () => {
    const actual = runScanner(note)
    assert.equal(actual.status, 1, 'missed fabricated direct identifier ' + JSON.stringify(note) + '\n' + actual.output)
    assert.match(actual.output, /obvious participant identifier/)
  })
}

test('QA #1528 independent acceptance permits non-identifier documentation', () => {
  for (const note of [
    '- grocery&#x0009;item: edamame',
    '| price&#00010;context | in-store |',
    '> Basket&#XD;total: EUR 40',
    '<dt>store&#x9;id</dt><dd>plus</dd>',
    '<td>product&#10;name</td><td>Rice</td>',
    '3. meal&#x0D;name: Curry',
    'participantKey: fictional-pseudonym-004',
    'Policy: never commit direct participant names or personal email addresses.',
  ]) {
    const actual = runScanner(note)
    assert.equal(actual.status, 0, 'false positive on legitimate note ' + JSON.stringify(note) + '\n' + actual.output)
  }
})
