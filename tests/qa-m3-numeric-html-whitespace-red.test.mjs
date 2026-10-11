import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// QA #1528: deliberately synthetic explicit direct-ID fields only.
// Tests the actual scanner with disposable nested M3 notes, not actual people.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function check(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-numeric-html-space-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'nested'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Temporary synthetic policy\n')
    const path = join(root, 'evidence', 'm3', 'nested', 'synthetic.md')
    writeFileSync(path, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null)
    assert.equal(readFileSync(path, 'utf8'), note, 'test must not modify original note bytes')
    return { code: result.status, output: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, note] of [
  ['decimal nonbreaking space', '- participant&#160;name: imaginary-label'],
  ['hex nonbreaking space in quote', '"full&#xA0;name" = invented-label'],
  ['decimal narrow no-break in table', '| participant&#8239;email | fictional-value |'],
  ['hex narrow no-break with heading', '## Account&#x202F;ID: synthetic-key'],
  ['decimal en-space in bullet', '- account&#8194;email: invented-data'],
  ['hex thin space in numbered field', '1. naam&#x2009;deelnemer: imaginary-person'],
  ['decimal ideographic space', '- full&#12288;name: invented-value'],
]) {
  test('QA #1528 expected RED: numeric HTML whitespace hides direct-ID field: ' + label, () => {
    const result = check(note)
    assert.equal(result.code, 1, 'missed labelled fictional ID: ' + JSON.stringify(note) + '\n' + result.output)
    assert.match(result.output, /obvious participant identifier/)
  })
}

test('QA #1528 expected RED: benign shopping and policy notes remain allowed', () => {
  for (const note of [
    '- ingredient&#160;name: broccoli',
    '| store&#8239;name | PLUS |',
    '## Cooking&#x2009;Time: 15 minutes',
    'participantKey: pseudonymous-student-001',
    'Never record participant&#160;name in stored M3 notes.',
    'Receipt images and direct IDs are forbidden by this privacy policy.',
    '- invalid numeric reference &#xQQ; should remain harmless',
  ]) {
    const result = check(note)
    assert.equal(result.code, 0, 'false positive on harmless note: ' + JSON.stringify(note) + '\n' + result.output)
  }
})
