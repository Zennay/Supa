import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independently exercise the real staged M3 guard. All names and domains are synthetic.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))
function check(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-numeric-entity-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'fictional'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic-only evidence\n')
    const path = join(root, 'evidence', 'm3', 'fictional', 'note.md')
    writeFileSync(path, note)
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    assert.equal(readFileSync(path, 'utf8'), note, 'original note must remain byte-for-byte intact')
    return { status: child.status, log: child.stdout + child.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('QA #1528: encoded visible ASCII identity labels remain protected', () => {
  for (const note of [
    '- &#112;articipant_name: fictitious-value',
    '- participant&#x2e;email = fictional-value',
    '> **account&#45;id**: invented-value',
    '| full&#x20;name | synthetic-value |',
    '1. e&#45;mail&#45;adres: synthetic-contact',
  ]) {
    const result = check(note)
    assert.equal(result.status, 1, 'decoded identity escaped scanner: ' + JSON.stringify(note) + '\n' + result.log)
    assert.match(result.log, /obvious participant identifier/)
  }
})

test('QA #1528: encoded email in original text and URL targets must remain visible', () => {
  for (const note of [
    'Contact: imaginary&#64;example.test',
    '[contact](mailto:imaginary&#x40;example.test)',
    '<a href="https://example.invalid/u?email=imaginary&#64;example.test">policy</a>',
  ]) {
    const result = check(note)
    assert.equal(result.status, 1, 'encoded email evaded scanner: ' + JSON.stringify(note) + '\n' + result.log)
    assert.match(result.log, /obvious participant identifier/)
  }
})

test('QA #1528: invalid references, policy and ingredient labels remain benign', () => {
  for (const note of [
    '- studyId: fictional&#45;week-1',
    '| ingredient name | broccoli &#38; potato |',
    '- store name: PLUS &#38; DekaMarkt',
    'Avoid adding participant&#95;name to evidence.',
    '- participantKey: synthetic&#x2D;pseudonym',
    'Reference text: &amp; is not a direct identifier.',
    'Encoded syntax literally &#xZZ; is not an identifier.',
  ]) {
    const result = check(note)
    assert.equal(result.status, 0, 'benign text rejected: ' + JSON.stringify(note) + '\n' + result.log)
  }
})
