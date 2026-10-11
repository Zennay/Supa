import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// QA #1528: these HTML5 named spacing references render visible whitespace
// in CommonMark. Fictitious notes only; never write real identifiers or M3 proof.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function scanDisposableNote(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-html-named-space-red-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'nested'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic evidence policy\n')
    const notePath = join(root, 'evidence', 'm3', 'nested', 'note.md')
    writeFileSync(notePath, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const run = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(run.error)
    assert.notEqual(run.status, null)
    assert.equal(readFileSync(notePath, 'utf8'), note, 'scan may not rewrite Markdown bytes')
    return { status: run.status, output: run.stdout + run.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, note] of [
  ['EM SPACE full name', '- full&emsp;name: fictitious-one'],
  ['EN SPACE account email', '> account&ensp;email = invented-two'],
  ['thin space participant', '**participant&thinsp;name**: synthetic-three'],
  ['ThinSpace Dutch email', '1. e&ThinSpace;mail&ThinSpace;adres: mock-four'],
  ['figure space HTML table', '<th>account&numsp;id</th><td>made-up-five</td>'],
  ['medium mathematical space definition', '<dt>naam&MediumSpace;deelnemer</dt><dd>dummy-six</dd>'],
  ['hair space quoted identifier', '"participant&hairsp;email": placeholder-seven'],
  ['punctuation space Markdown table', '| account&puncsp;email | fictitious-eight |'],
]) {
  test('QA #1528 expected RED: rendered named HTML space cannot hide ' + label, () => {
    const run = scanDisposableNote(note)
    assert.equal(run.status, 1, 'scanner missed fictional rendered label: ' + note + '\n' + run.output)
    assert.match(run.output, /obvious participant identifier/)
  })
}

test('QA #1528 named HTML spaces preserve benign grocery, policy and pseudonymous notes', () => {
  for (const note of [
    'ingredient&emsp;name: spinach',
    '> Store&ensp;id: PLUS',
    '**recipe&thinsp;name**: pasta',
    '1. meal&ThinSpace;plan: lunch',
    '<th>product&numsp;category</th><td>vegetables</td>',
    '<dt>basket&MediumSpace;source</dt><dd>manual</dd>',
    'participantKey: anonymous-test-7',
    'Policy: do not disclose full&hairsp;name in notes.',
    'M3 policy prohibits email addresses and personal names.',
  ]) {
    const run = scanDisposableNote(note)
    assert.equal(run.status, 0, 'safe note was rejected: ' + note + '\n' + run.output)
  }
})
