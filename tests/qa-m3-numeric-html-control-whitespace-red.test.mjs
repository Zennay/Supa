import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent #1528 synthetic negative probe on immutable #1718.
// CommonMark numeric character references U+0009/U+000A/U+000D render
// as whitespace but the scanner currently preserves their literal text.
// No real identifiers, evidence notes, or product code are modified.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-control-space-red-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'nested'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Fictional M3 evidence policy\n')
    const target = join(root, 'evidence', 'm3', 'nested', 'note.md')
    writeFileSync(target, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const run = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(run.error)
    assert.notEqual(run.status, null)
    assert.equal(readFileSync(target, 'utf8'), note, 'the scanner must not alter evidence bytes')
    return { status: run.status, output: run.stdout + run.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, note] of [
  ['decimal tab in list', '- participant&#9;name: fake-person'],
  ['hex tab in table', '| full&#x09;name | fictional-person |'],
  ['decimal LF in quote', '> account&#10;id = invented-reference'],
  ['decimal CR in quoted key', '"account&#13;email": fictional-reference'],
  ['two tabs in Dutch email field', '1. e&#9;mail&#9;adres: fictional-contact'],
  ['hex LF in heading', '## participant&#xA;email: fictional-contact'],
]) {
  test('QA #1528 expected RED: reject rendered numeric control-space direct ID - ' + label, () => {
    const result = scan(note)
    assert.equal(result.status, 1, 'scanner missed fictional direct ID: ' + JSON.stringify(note) + '\n' + result.output)
    assert.match(result.output, /obvious participant identifier/)
  })
}

test('QA #1528 numeric control-space probe must allow safe grocery and policy notes', () => {
  for (const note of [
    '- ingredient&#9;name: broccoli',
    '| store&#x09;name | PLUS |',
    '## cooking&#10;time: 25 minutes',
    'recipe&#13;note: boil water',
    'participantKey: synthetic-key-003',
    'Policy prohibits participant&#9;name disclosure.',
    'M3 stores no email addresses or receipts.',
  ]) {
    const result = scan(note)
    assert.equal(result.status, 0, 'unexpected false positive: ' + JSON.stringify(note) + '\n' + result.output)
  }
})
