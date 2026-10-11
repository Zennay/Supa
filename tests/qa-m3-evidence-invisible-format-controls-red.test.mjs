import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Synthetic QA acceptance against the actual staged Markdown privacy scanner.
// Invisibility is checked in scan text only; evidence files must not be edited.
// This is a bounded backstop for obvious direct-ID declarations, not a PII oracle.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function inspect(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-format-controls-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic QA evidence\n')
    const sample = join(root, 'evidence', 'm3', 'sample.md')
    writeFileSync(sample, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null, 'test child must complete')
    assert.equal(readFileSync(sample, 'utf8'), note, 'inspection must preserve original evidence bytes')
    return { code: child.status, log: child.stdout + child.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [name, note] of [
  ['soft hyphen in a declared participant field', 'participant\u00ad_name: fabricated-record'],
  ['byte-order mark in an explicit full-name field', '**full\uFEFF name**: fabricated-label'],
  ['left-to-right mark inside an email address', 'fake@exam\u200eple.test'],
  ['directional isolate marks in an HTML identifier', '<dt>account\u2066-id\u2069</dt><dd><b>synthetic-account</b></dd>'],
]) {
  test('QA #1528: reject ' + name, () => {
    const r = inspect(note)
    assert.equal(r.code, 1, 'visually unchanged explicit identifier passed: ' + name + '\n' + r.log)
    assert.match(r.log, /obvious participant identifier/)
  })
}

test('QA #1528: controls remain accepted, pseudonymous and grocery metadata included', () => {
  for (const note of [
    'participant\u00adKey: pseudonymous-study-reference',
    'study\uFEFFId: synthetic-week',
    'ingredient\u200e-name: Broccoli',
    'store\u2066-name\u2069: PLUS',
    '# Privacy rule\nDo not disclose full names or participant emails in M3.',
    '<dt>account-id</dt><dd><strong></strong></dd>',
  ]) {
    const r = inspect(note)
    assert.equal(r.code, 0, 'benign or empty-value control rejected: ' + JSON.stringify(note) + '\n' + r.log)
  }
})
