import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Narrow synthetic M3 privacy probe. These HTML phrasing tags render their
// text visibly; no real participant identifiers or evidence are used.
const name = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + name, import.meta.url))

function scanSyntheticNote(markdown) {
  const dir = mkdtempSync(join(tmpdir(), 'supa-visible-phrasing-red-'))
  try {
    const tests = join(dir, 'tests')
    const evidence = join(dir, 'evidence', 'm3', 'nested')
    mkdirSync(tests, { recursive: true })
    mkdirSync(evidence, { recursive: true })
    copyFileSync(scanner, join(tests, name))
    writeFileSync(join(dir, 'evidence', 'm3', 'README.md'), '# Synthetic review-only scope\n')
    const note = join(evidence, 'observation.md')
    writeFileSync(note, markdown)
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const run = spawnSync(process.execPath, ['--test', join(tests, name)], {
      cwd: dir, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(run.error)
    assert.notEqual(run.status, null, 'scanner did not complete')
    assert.equal(readFileSync(note, 'utf8'), markdown, 'scanner must not rewrite evidence bytes')
    return { status: run.status, log: (run.stdout || '') + (run.stderr || '') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

for (const [label, markdown] of [
  ['inserted participant email', 'participant<ins>email</ins>: synthetic-one'],
  ['deleted full name in bold', '**full<del>name</del>**: synthetic-two'],
  ['struck-through account id in a table', '| account<s>id</s> | synthetic-three |'],
  ['defined participant name', '<dt>participant<dfn>name</dfn></dt><dd>synthetic-four</dd>'],
  ['variable account id', '<dt>account<var>id</var></dt><dd>synthetic-five</dd>'],
  ['cited participant name in a quote', '> participant<cite>name</cite> = synthetic-six'],
]) {
  test('QA M3 visible HTML label must reject ' + label, () => {
    const result = scanSyntheticNote(markdown)
    assert.equal(result.status, 1, 'visible labelled direct ID escaped scan: ' + markdown + '\n' + result.log)
    assert.match(result.log, /obvious participant identifier/)
  })
}

test('QA M3 visible HTML labels preserve harmless grocery and policy notes', () => {
  for (const markdown of [
    'product<ins>name</ins>: cauliflower',
    '| recipe<del>name</del> | chickpea bowl |',
    '<dt>basket<dfn>id</dfn></dt><dd>demo-001</dd>',
    'store<var>name</var> = Example Market',
    '> ingredient<cite>name</cite> = tomato',
    'participantKey: pseudonymous-test-001',
    'Privacy policy: do not commit names, email addresses or receipts.',
  ]) {
    const result = scanSyntheticNote(markdown)
    assert.equal(result.status, 0, 'safe grocery metadata incorrectly rejected: ' + markdown + '\n' + result.log)
  }
})
