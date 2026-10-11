import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent expected-RED diagnostic for QA #1528 on frozen #1702.
// Synthetic identifiers only; tests execute the actual M3 Markdown privacy
// guard in a disposable nested evidence tree without changing source notes.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-visible-phrasing-red-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'nested'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic M3 policy\n')
    const path = join(root, 'evidence', 'm3', 'nested', 'note.md')
    writeFileSync(path, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    assert.equal(readFileSync(path, 'utf8'), note, 'scanning must not rewrite evidence')
    return { status: child.status, output: child.stdout + child.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// All four tags render visible content in HTML; stripping only
// mark/u/small leaves explicit identifiers split across tag boundaries.
for (const [label, note] of [
  ['superscript fragment', '- participant<sup>_name</sup>: synthetic-value'],
  ['subscript fragment', '> account<sub>_id</sub> = imaginary-value'],
  ['keyboard fragment', '1. full<kbd> name</kbd>: fictitious-user'],
  ['abbreviation fragment', '| participant<abbr title="label">_email</abbr> | imaginary-contact |'],
]) {
  test('QA #1528 rejects visibly split direct-ID field: ' + label, () => {
    const actual = scan(note)
    assert.equal(actual.status, 1, 'missed fictional identifier ' + JSON.stringify(note) + '\n' + actual.output)
    assert.match(actual.output, /obvious participant identifier/)
  })
}

test('QA #1528 allows harmless phrasing markup and policy references', () => {
  for (const note of [
    '- ingredient<sup>_name</sup>: courgette',
    '> store<sub>_id</sub> = plus-demo',
    'Recipe: press <kbd>Enter</kbd> for the ingredient.',
    '| participant<abbr>_email</abbr> | forbidden example field, never store it |',
    '- participantKey: pseudonymized-student-01',
  ]) {
    const actual = scan(note)
    assert.equal(actual.status, 0, 'false positive for ' + JSON.stringify(note) + '\n' + actual.output)
  }
})
