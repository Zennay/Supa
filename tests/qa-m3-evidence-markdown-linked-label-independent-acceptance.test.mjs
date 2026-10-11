import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent postrepair acceptance for #1528/#1656, fictional values only.
// Exercise the actual staged scanner inside throwaway nested M3 evidence.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function inspect(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-link-acceptance-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'week-002'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic policy\n', 'utf8')
    const path = join(root, 'evidence', 'm3', 'week-002', 'note.md')
    writeFileSync(path, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null)
    assert.equal(readFileSync(path, 'utf8'), note, 'scanner must preserve original source bytes')
    return { status: result.status, log: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('QA #1528: additional linked direct-ID labels in lists, tables and HTML refuse persistence', () => {
  for (const note of [
    '1. [participant.email](#subject) = imaginary-recipient',
    '> | [full-name](#subject) | fictive-label |',
    '- [account_email](#account): imaginary-contact',
    '<tr><th><a href="#account">account-id</a></th><td>sample-001</td></tr>',
    '<dt><a href="#person">participant name</a></dt><dd>sample-subject</dd>',
    '<!-- [full name](#subject): sample-only -->',
  ]) {
    const outcome = inspect(note)
    assert.equal(outcome.status, 1, 'synthetic ID disclosure escaped guard: ' + JSON.stringify(note) + '\n' + outcome.log)
    assert.match(outcome.log, /obvious participant identifier/)
  }
})

test('QA #1528: linked safe metadata and ordinary human-readable privacy advice stay acceptable', () => {
  for (const note of [
    '- [participantKey](#key): pseudonym-001',
    '> | [ingredient name](#ingredient) | rice |',
    '<dt><a href="#store">store name</a></dt><dd>PLUS</dd>',
    '<td><a href="#item">product name</a></td><td>Rice</td>',
    'Policy: never record [full name](#guidance) in evidence.',
    '- [studyId](#study): synthetic-week',
  ]) {
    const outcome = inspect(note)
    assert.equal(outcome.status, 0, 'benign metadata link was rejected: ' + JSON.stringify(note) + '\n' + outcome.log)
  }
})
