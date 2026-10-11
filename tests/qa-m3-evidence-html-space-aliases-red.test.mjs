import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// QA #1528: HTML5 has multiple official spellings for whitespace and
// zero-width separators. This is an intentionally failing, fictitious
// downstream privacy regression, not real M3 participant evidence.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function checkFictitiousMarkdown(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-html-alias-red-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'nested', 'case'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Fictional privacy policy\n')
    const target = join(root, 'evidence', 'm3', 'nested', 'case', 'note.md')
    writeFileSync(target, markdown, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const run = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(run.error)
    assert.notEqual(run.status, null)
    assert.equal(readFileSync(target, 'utf8'), markdown, 'evidence bytes must remain unchanged')
    return { status: run.status, output: run.stdout + run.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, note] of [
  ['NonBreakingSpace', '- participant&NonBreakingSpace;name: fictional-alpha'],
  ['VeryThinSpace', '> **full&VeryThinSpace;name** = invented-bravo'],
  ['ThickSpace', '**account&ThickSpace;email**: made-up-charlie'],
  ['emsp13', '2. e&emsp13;mail&emsp13;adres: imaginary-delta'],
  ['emsp14', 'account&emsp14;id = placeholder-echo'],
  ['NegativeThinSpace', '<th>account&NegativeThinSpace;id</th><td>dummy-foxtrot</td>'],
  ['NegativeMediumSpace', '<dt>naam&NegativeMediumSpace;deelnemer</dt><dd>test-golf</dd>'],
  ['NegativeThickSpace', '"participant&NegativeThickSpace;email": mock-hotel'],
  ['NegativeVeryThinSpace', '| full&NegativeVeryThinSpace;name | example-india |'],
]) {
  test('QA #1528 expected RED: named HTML5 entity alias hides explicit fictional ID: ' + label, () => {
    const run = checkFictitiousMarkdown(note)
    assert.equal(run.status, 1, 'missed rendered fictional disclosure ' + note + '\n' + run.output)
    assert.match(run.output, /obvious participant identifier/)
  })
}

test('QA #1528 named HTML5 aliases must allow ordinary recipe and policy metadata', () => {
  for (const note of [
    '- ingredient&NonBreakingSpace;name: cauliflower',
    'recipe&VeryThinSpace;name: bowl',
    '> store&ThickSpace;id: PLUS',
    '2. meal&emsp13;plan: dinner',
    'product&emsp14;category: fresh',
    '<th>basket&NegativeThinSpace;source</th><td>manual</td>',
    '<dt>retailer&NegativeMediumSpace;label</dt><dd>DekaMarkt</dd>',
    'participantKey: fake-pseudonym',
    'Policy forbids full&NegativeThickSpace;name disclosure.',
    'No email address is included here.',
  ]) {
    const run = checkFictitiousMarkdown(note)
    assert.equal(run.status, 0, 'false positive on benign M3 note: ' + note + '\n' + run.output)
  }
})
