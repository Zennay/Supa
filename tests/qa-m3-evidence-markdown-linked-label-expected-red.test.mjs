import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// #1528: add-only, expected-RED, independent linked-label privacy regression.
// All identifiers and values here are fictional; no real M3 evidence is read.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function runAgainstDisposableEvidence(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-linked-label-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'week-001'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Fictional M3 validation\n', 'utf8')
    const notePath = join(root, 'evidence', 'm3', 'week-001', 'synthetic.md')
    writeFileSync(notePath, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null, 'child scanner must execute')
    assert.equal(readFileSync(notePath, 'utf8'), note, 'scanner must never mutate evidence')
    return { status: result.status, log: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const explicitIdentifierLinks = [
  '- [participant_name](https://example.invalid/ref): fabricated-subject',
  '> **[Full Name](#person)** = imaginary-subject',
  '| [account-id](#record) | fabricated-id |',
  '<table><tr><td><a href="#person">participant_name</a></td><td>imaginary</td></tr></table>',
  '<dl><dt><a href="#person">full name</a></dt><dd>fabricated</dd></dl>',
]

for (const [index, note] of explicitIdentifierLinks.entries()) {
  test('QA #1528: linked explicit direct-ID label must fail closed (' + (index + 1) + ')', () => {
    const result = runAgainstDisposableEvidence(note)
    assert.equal(result.status, 1, 'missed linked label: ' + JSON.stringify(note) + '\n' + result.log)
    assert.match(result.log, /obvious participant identifier/)
  })
}

test('QA #1528: ordinary ingredient/store links and pseudonymous aliases remain allowed', () => {
  for (const note of [
    '- [Ingredient name](#ingredient): courgette',
    '| [Store name](#store) | PLUS |',
    '[participantKey](#anon): pseudonymous-key-001',
    'Do not include [participant names](#policy) in public notes.',
    '<td><a href="#ingredient">ingredient name</a></td><td>rice</td>',
    '<dt><a href="#store">store name</a></dt><dd>DekaMarkt</dd>',
  ]) {
    const result = runAgainstDisposableEvidence(note)
    assert.equal(result.status, 0, 'false positive for ordinary linked label: ' + JSON.stringify(note) + '\n' + result.log)
  }
})
