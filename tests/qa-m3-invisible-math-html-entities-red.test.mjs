import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Expected RED on frozen QA #1732: three standard HTML5 math entities render
// as invisible format characters U+2061..U+2063 in CommonMark/HTML.
// All identities are invented and no real observation file is used.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function scanDisposableNote(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-math-invisible-red-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'synthetic', 'nested'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic privacy contract\n')
    const file = join(root, 'evidence', 'm3', 'synthetic', 'nested', 'note.md')
    writeFileSync(file, markdown, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null, 'privacy scanner timed out or was terminated')
    assert.equal(readFileSync(file, 'utf8'), markdown, 'scanner must not change evidence bytes')
    return { status: result.status, output: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, markdown] of [
  ['plain ApplyFunction in participant email', 'participant&ApplyFunction;email: imaginary-one'],
  ['strong InvisibleTimes full name', '**full&InvisibleTimes;name** = imaginary-two'],
  ['table InvisibleComma account id', '| account&InvisibleComma;id | fictitious-three |'],
  ['HTML definition InvisibleTimes participant name', '<dt>participant&InvisibleTimes;name</dt><dd>invented-four</dd>'],
  ['quoted InvisibleComma participant email', '> "participant&InvisibleComma;email": dummy-five'],
  ['Dutch ApplyFunction identity label', '- naam&ApplyFunction;deelnemer: fake-six'],
]) {
  test('QA #1528 invisible math HTML entity must reject ' + label, () => {
    const result = scanDisposableNote(markdown)
    assert.equal(
      result.status, 1,
      'scanner missed a clearly labelled fictional direct identifier: ' + markdown + '\n' + result.output,
    )
    assert.match(result.output, /obvious participant identifier/)
  })
}

test('QA #1528 math entity probes do not reject harmless grocery labels or policy descriptions', () => {
  for (const markdown of [
    'product&ApplyFunction;name: cauliflower',
    '**store&InvisibleTimes;id** = fictitious-store',
    '| recipe&InvisibleComma;name | tofu bowl |',
    '<dt>ingredient&ApplyFunction;name</dt><dd>carrot</dd>',
    '> "basket&InvisibleComma;id": invented-week',
    '- winkel&InvisibleTimes;naam: Test Market',
    'participantKey: pseudonym-test-123',
    'Policy: Never commit participant names or email addresses.',
  ]) {
    const result = scanDisposableNote(markdown)
    assert.equal(result.status, 0, 'harmless Markdown incorrectly rejected: ' + markdown + '\n' + result.output)
  }
})
