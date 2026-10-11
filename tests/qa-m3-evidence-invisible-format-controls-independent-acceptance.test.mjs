import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent add-only postrepair acceptance; no production or real M3 input.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-format-acceptance-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'week-001'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic evidence\n')
    const sample = join(root, 'evidence', 'm3', 'week-001', 'observation.md')
    writeFileSync(sample, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    assert.equal(readFileSync(sample, 'utf8'), note, 'privacy guard must never change evidence bytes')
    return { code: child.status, log: child.stdout + child.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('QA #1528: separate Unicode controls must not bypass Markdown, HTML and email detections', () => {
  for (const note of [
    '- participant\u200f_email: fictional-record',
    '> **full\u2067 name** = fictive-label',
    '| account\u00ad-id | imaginary-account |',
    '<!-- account\uFEFF_email: fabricated-reference -->',
    '<dt>participant\u2066-name</dt><dd><strong>not-a-real-person</strong></dd>',
    'fake@exa\u2068mple.test',
  ]) {
    const outcome = scan(note)
    assert.equal(outcome.code, 1, 'undetected synthetic disclosure: ' + JSON.stringify(note) + '\n' + outcome.log)
    assert.match(outcome.log, /obvious participant identifier/)
  }
})

test('QA #1528: legitimate weekly metadata, empty values and policy prose remain valid', () => {
  for (const note of [
    '# Evidence policy\nDo not share names or email addresses in receipts.',
    'participant\u200eKey: anonymous-001',
    'ingredient\uFEFF-name: Courgette',
    '<dt>account-id</dt><dd><strong></strong></dd>',
    'store\u2069-name: DekaMarkt',
    'studyId: non-identifying-control',
  ]) {
    const outcome = scan(note)
    assert.equal(outcome.code, 0, 'benign synthetic control rejected: ' + JSON.stringify(note) + '\n' + outcome.log)
  }
})
