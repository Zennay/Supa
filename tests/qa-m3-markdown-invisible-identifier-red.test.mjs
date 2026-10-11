import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// All strings and identifiers are fictional. Each case invokes the real
// staged guard in an isolated M3 evidence directory; no private files read.
const scanner = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scannerFile = fileURLToPath(new URL('./' + scanner, import.meta.url))
const zwsp = '\u200b'
const zwnj = '\u200c'
const zwj = '\u200d'
const wordJoiner = '\u2060'

function runActualScanner(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-invisible-identity-red-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3'), { recursive: true })
    copyFileSync(scannerFile, join(root, 'tests', scanner))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic guard regression\n')
    writeFileSync(join(root, 'evidence', 'm3', 'note.md'), markdown + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const r = spawnSync(process.execPath, ['--test', join(root, 'tests', scanner)], {
      cwd: root, env, encoding: 'utf8', timeout: 20000,
    })
    assert.ifError(r.error)
    assert.notEqual(r.status, null)
    return { status: r.status, output: r.stdout + r.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('QA #1528: format-invisible characters cannot hide explicitly labelled private values or email', () => {
  const cases = [
    'participant' + zwsp + '_name: synthetic-student',
    'account' + wordJoiner + '_id = synthetic-account',
    'full' + zwnj + '-name: synthetic-student',
    'synthetic@exam' + zwsp + 'ple.test',
    '<dt>participant' + zwj + '_email</dt><dd><span>synthetic-address-label</span></dd>',
  ]
  for (const note of cases) {
    const r = runActualScanner(note)
    assert.equal(r.status, 1, 'Format-invisible disclosure bypassed actual scanner:\n' + JSON.stringify(note) + '\n' + r.output)
    assert.match(r.output, /obvious participant identifier/, JSON.stringify(note))
  }
})

test('QA #1528: invisible formatting in benign metadata and ordinary policy language stays allowed', () => {
  for (const note of [
    'participant' + zwsp + 'Key: pseudonymous-key-01',
    'study' + zwj + 'Id: synthetic-study-01',
    'ingredient' + wordJoiner + '-name: Broccoli',
    'Store name: PLUS',
    'Only synthetic acceptance labels are used in this test.',
  ]) {
    const r = runActualScanner(note)
    assert.equal(r.status, 0, 'Benign synthetic note falsely rejected:\n' + JSON.stringify(note) + '\n' + r.output)
  }
})
