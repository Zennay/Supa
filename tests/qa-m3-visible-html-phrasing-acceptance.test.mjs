import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent postrepair acceptance, separate from original expected-RED
// samples. All invented observations live in a disposable temporary root.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function runOnPrivateNote(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-phrasing-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    const evidence = join(root, 'evidence', 'm3')
    mkdirSync(join(evidence, 'review', 'nested'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(evidence, 'README.md'), '# Synthetic scanner contract\n')
    const note = join(evidence, 'review', 'nested', 'test.md')
    writeFileSync(note, markdown)
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const run = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(run.error)
    assert.notEqual(run.status, null, 'scanner did not exit')
    assert.equal(readFileSync(note, 'utf8'), markdown, 'original M3 Markdown must remain unchanged')
    return { pass: run.status === 0, output: (run.stdout || '') + (run.stderr || '') }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, markdown] of [
  ['HTML cells with inserted name suffix', '<td>participant<ins>email</ins></td><td>fake-one</td>'],
  ['nested Markdown emphasis and HTML variable', '***account<var>id</var>***: fake-two'],
  ['numbered quote with defining-name phrase', '> 1. full<dfn>name</dfn>: fake-three'],
  ['paired HTML definition with two visible markup types', '<dt><ins>participant</ins><del>name</del></dt><dd><span>fake-four</span></dd>'],
  ['table with citation and strike tags', '<th><cite>account</cite><s>email</s></th><td>fake-five</td>'],
  ['quoted field with a variable phrase', '> "participant<var>email</var>": fake-six'],
]) {
  test('QA #1737 independent postrepair: reject ' + label, () => {
    const scan = runOnPrivateNote(markdown)
    assert.equal(scan.pass, false, 'unreported visible direct-ID field: ' + markdown + '\n' + scan.output)
    assert.match(scan.output, /obvious participant identifier/)
  })
}

test('QA #1737 independent postrepair: allow unrelated rendered grocery labels', () => {
  for (const markdown of [
    '<td>ingredient<ins>name</ins></td><td>broccoli</td>',
    '***recipe<var>id</var>***: synthetic-recipe',
    '> 1. plan<dfn>name</dfn>: family dinner',
    '<dt><ins>store</ins><del>name</del></dt><dd><span>Demo Market</span></dd>',
    '<th><cite>basket</cite><s>id</s></th><td>week-1</td>',
    'participantKey: pseudonymous-study-a',
    'Policy: personal names and emails must never be committed.',
  ]) {
    const scan = runOnPrivateNote(markdown)
    assert.equal(scan.pass, true, 'ordinary metadata rejected: ' + markdown + '\n' + scan.output)
  }
})
