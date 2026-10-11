import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent postrepair acceptance for #1528. Fictional labels/values only.
// Black-box execution of the actual M3 evidence privacy boundary under a
// disposable nested folder; original note content is asserted unchanged.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function inspect(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-visible-phrasing-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'fictional', 'nested'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Privacy evidence contract\n')
    const path = join(root, 'evidence', 'm3', 'fictional', 'nested', 'note.md')
    writeFileSync(path, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    assert.equal(readFileSync(path, 'utf8'), note, 'scanner must preserve original evidence bytes')
    return { status: child.status, output: child.stdout + child.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, note] of [
  ['superscript with attribute', '- participant<sup data-label="unit">_name</sup>: synthetic-student'],
  ['uppercase subscript in quote', '> ACCOUNT<SUB>_ID</SUB> = fictional-account'],
  ['nested keyboard plus subscript', '2. full<kbd><sub> name</sub></kbd>: imaginary-user'],
  ['HTML table cells', '<table><tr><td>participant<sup>_email</sup></td><td>not-real-contact</td></tr></table>'],
  ['visible e-mail split', 'Contact: fictional@exam<sup>ple</sup>.test'],
  ['linked abbreviation label', '- [participant<abbr title="accounting">_name</abbr>](#policy): invented-person'],
]) {
  test('QA #1528 independently rejects visible HTML direct-ID: ' + label, () => {
    const r = inspect(note)
    assert.equal(r.status, 1, 'missed visible disclosure ' + JSON.stringify(note) + '\n' + r.output)
    assert.match(r.output, /obvious participant identifier/)
  })
}

test('QA #1528 permits benign grocery fields, research metadata and descriptive policy', () => {
  for (const note of [
    '- ingredient<sup>_name</sup>: broccoli',
    '> STORE<SUB>_ID</SUB> = example-retailer',
    'Press <kbd>Enter</kbd> to open a recipe.',
    'A common <abbr title="acronym">M3</abbr> evidence policy summary.',
    'Never record participant<sup>_name</sup> in field notes.',
    'participantKey: fictional-pseudonymous-001',
    '| store<kbd>_name</kbd> | PLUS |',
  ]) {
    const r = inspect(note)
    assert.equal(r.status, 0, 'false positive for safe note ' + JSON.stringify(note) + '\n' + r.output)
  }
})
