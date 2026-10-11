import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent QA #1528 acceptance: fictional field values only.
// Run the real scanner on isolated disposable nested M3 evidence.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))
function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-space-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'nested', 'sub'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Fake M3 policy\n')
    const target = join(root, 'evidence', 'm3', 'nested', 'sub', 'note.md')
    writeFileSync(target, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null)
    assert.equal(readFileSync(target, 'utf8'), note, 'scanner must preserve original Markdown bytes')
    return { status: result.status, output: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, note] of [
  ['ogham space decimal with equals', '- participant&#5760;name = invented-identifier'],
  ['figure space hex in table', '| full&#x2007;name | madeup-identifier |'],
  ['hair space decimal in blockquote', '> account&#8202;id: synthetic-key'],
  ['medium mathematical space inside quoted label', '"account&#8287;email" = madeup-value'],
  ['en quad uppercase hexadecimal', '3. e&#X2000;mail&#X2000;adres: invented-contact'],
  ['ideographic space hex and markdown emphasis', '**Full&#x3000;Name**: fictional-identity'],
]) {
  test('QA #1528 independent numeric-space acceptance rejects direct-ID: ' + label, () => {
    const r = scan(note)
    assert.equal(r.status, 1, 'missed synthetic disclosure ' + JSON.stringify(note) + '\n' + r.output)
    assert.match(r.output, /obvious participant identifier/)
  })
}

test('QA #1528 independent numeric-space acceptance allows safe notes', () => {
  for (const note of [
    '- Ingredient&#x2007;name: edamame',
    '| store&#5760;name | PLUS |',
    '## Cooking&#x3000;Time: 30 minutes',
    'participantKey: student-fake-002',
    'M3 policy forbids full&#x2007;name values.',
    'An unsupported &#xD800; surrogate reference should not become an identifier.',
    'Use no names, addresses, contact emails or receipts in M3 evidence.',
    'Recipe&#8287;note: use chilled water.',
  ]) {
    const r = scan(note)
    assert.equal(r.status, 0, 'false positive on benign note ' + JSON.stringify(note) + '\n' + r.output)
  }
})
