import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Synthetic, independent expected-RED review of HTML character references
// in visibly rendered M3 identity field labels; never inspect real evidence.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function inspect(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-entity-label-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'synthetic'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Fictional fixture\n')
    const path = join(root, 'evidence', 'm3', 'synthetic', 'note.md')
    writeFileSync(path, note)
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    assert.equal(readFileSync(path, 'utf8'), note, 'synthetic note must remain byte-for-byte intact')
    return { status: child.status, log: child.stdout + child.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('QA #1528: rendered HTML numeric entities must not hide explicit direct-ID field labels', () => {
  for (const note of [
    '- participant&#95;name: fictional-person',
    '| full&#32;name | invented-person |',
    '> account&#x2d;id = fictional-account',
    '**e&#45;mail&#45;adres**: fictional-contact',
    '3. participant&#x2E;email: fictional-contact',
  ]) {
    const result = inspect(note)
    assert.equal(result.status, 1, 'visible identifier field evaded scan: ' + JSON.stringify(note) + '\n' + result.log)
    assert.match(result.log, /obvious participant identifier/)
  }
})

test('QA #1528: harmless entities and policy text must not cause false positives', () => {
  for (const note of [
    '- ingredient name: broccoli &#38; rice',
    '| store name | PLUS &#38; DekaMarkt |',
    'participantKey: synthetic&#45;anonymous',
    'Avoid storing participant&#95;name in a human observation note.',
    '- studyId: fictional-week-1',
  ]) {
    const result = inspect(note)
    assert.equal(result.status, 0, 'benign entity text rejected: ' + JSON.stringify(note) + '\n' + result.log)
  }
})
