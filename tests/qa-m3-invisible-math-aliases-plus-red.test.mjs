import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Expected-RED on frozen QA #1739. HTML5 named aliases af/it/ic
// render U+2061/2062/2063 respectively. U+2064 is INVISIBLE PLUS.
// All values are invented. Run real scanner in disposable nested evidence.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function scan(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-invisible-aliases-red-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'nested', 'synthetic'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic evidence policy\n')
    const file = join(root, 'evidence', 'm3', 'nested', 'synthetic', 'note.md')
    writeFileSync(file, markdown, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null, 'scanner did not return a process status')
    assert.equal(readFileSync(file, 'utf8'), markdown, 'the privacy scanner must not rewrite evidence')
    return { status: result.status, output: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, markdown] of [
  ['af alias plain participant email', 'participant&af;email: fabricated-alpha'],
  ['it alias strong full name', '**full&it;name** = invented-beta'],
  ['ic alias table account id', '| account&ic;id | fictional-gamma |'],
  ['af alias HTML definition participant name', '<dt>participant&af;name</dt><dd>imaginary-delta</dd>'],
  ['ic alias quoted account email', '> "account&ic;email": dummy-epsilon'],
  ['raw U+2064 INVISIBLE PLUS', 'participant\u2064name: made-up-zeta'],
  ['hex numeric U+2064', '**full&#x2064;name**: fictitious-eta'],
  ['decimal numeric U+2064', '- naam&#8292;deelnemer: placeholder-theta'],
]) {
  test('QA #1737 aliases and U+2064 reject fictitious identifier: ' + label, () => {
    const out = scan(markdown)
    assert.equal(out.status, 1, 'missed synthetically labelled identifier: ' + markdown + '\n' + out.output)
    assert.match(out.output, /obvious participant identifier/)
  })
}

test('QA #1737 aliases and U+2064 preserve benign grocery/policy metadata', () => {
  for (const markdown of [
    'product&af;name: kale',
    '**recipe&it;name**: lentil bowl',
    '| grocery&ic;id | demo-007 |',
    '<dt>ingredient&af;name</dt><dd>rice</dd>',
    'basket\u2064source: handwritten',
    'store&#x2064;name: synthetic market',
    '- plan&#8292;description: week-1',
    'participantKey: pseudonym-week-A',
    'Policy: do not store full names or participant emails.',
  ]) {
    const out = scan(markdown)
    assert.equal(out.status, 0, 'incorrectly rejected benign metadata: ' + markdown + '\n' + out.output)
  }
})
