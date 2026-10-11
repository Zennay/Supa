import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Follow-on scoped QA #1737/#1528 probe from frozen #1742. Controlled,
// invented examples only. No real participant, retailer or M3 price evidence.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function disposableScan(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-invisible-format-qa-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'nested'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic study boundary\n')
    const path = join(root, 'evidence', 'm3', 'nested', 'sample.md')
    writeFileSync(path, markdown, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null)
    assert.equal(readFileSync(path, 'utf8'), markdown, 'scanner cannot mutate original evidence bytes')
    return { status: result.status, output: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [name, markdown] of [
  ['raw VS16 in participant label', '- participant\uFE0Fname: invented-one'],
  ['raw VS15 in full-name label', '**full\uFE0Ename**: invented-two'],
  ['combining grapheme joiner in account email', '> account\u034Femail = imagined-three'],
  ['Arabic Letter Mark in table identity label', '| participant\u061Cemail | fabricated-four |'],
  ['Mongolian Vowel Separator in Dutch label', 'naam\u180Edeelnemer: fictitious-five'],
  ['hex numeric VS16 in account ID', 'account&#xFE0F;id: test-six'],
  ['decimal numeric combining grapheme joiner', '<dt>participant&#847;name</dt><dd>madeup-seven</dd>'],
  ['decimal numeric Arabic Letter Mark in HTML table', '<th>full&#1564;name</th><td>dummy-eight</td>'],
  ['raw VS16 inside a fictional email address', 'contact: fakename\uFE0F@example.test'],
]) {
  test('QA #1737 expected RED: invisible format mark cannot conceal ' + name, () => {
    const result = disposableScan(markdown)
    assert.equal(result.status, 1, 'missed invented explicit identifier: ' + name + '\n' + result.output)
    assert.match(result.output, /obvious participant identifier/)
  })
}

test('QA #1737 controls: invisible marks must not block legitimate grocery and privacy documentation', () => {
  for (const markdown of [
    'item\uFE0Fname: broccoli',
    '**recipe\uFE0Ename**: vegetable bowl',
    '> ingredient\u034Funit: g',
    '| product\u061Ccategory | frozen |',
    'store\u180Ecode: fixture-plus',
    'basket&#xFE0F;week: 1',
    'participantKey: pseudonym-004',
    'Policy only: participant names and emails must never be committed.',
  ]) {
    const result = disposableScan(markdown)
    assert.equal(result.status, 0, 'legitimate synthetic metadata was blocked: ' + markdown + '\n' + result.output)
  }
})
