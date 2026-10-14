import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independently verify the proposed HTML5 alias repair with different
// fictional layouts from the RED probe. No real identities or M3 observations.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function scanNote(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-html-alias-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'deep', 'test'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Imaginary data policy\n')
    const target = join(root, 'evidence', 'm3', 'deep', 'test', 'record.md')
    writeFileSync(target, markdown, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const out = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(out.error)
    assert.notEqual(out.status, null)
    assert.equal(readFileSync(target, 'utf8'), markdown, 'M3 markdown source must stay byte-exact')
    return { status: out.status, output: out.stdout + out.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [name, markdown] of [
  ['HTML definition NonBreakingSpace', '<dt>participant&NonBreakingSpace;email</dt><dd>fictitious-one</dd>'],
  ['HTML table VeryThinSpace', '<th>full&VeryThinSpace;name</th><td>invented-two</td>'],
  ['Markdown table ThickSpace', '| account&ThickSpace;id | dummy-three |'],
  ['numbered emsp13 plus emsp14', '3. **e&emsp13;mail&emsp14;adres** = example-four'],
  ['quoted NegativeThinSpace', '> "participant&NegativeThinSpace;name": fake-five'],
  ['Markdown strong NegativeMediumSpace', '**full&NegativeMediumSpace;name**: imaginary-six'],
  ['unmarked NegativeThickSpace', 'account&NegativeThickSpace;email = test-seven'],
  ['Dutch NegativeVeryThinSpace', 'Naam&NegativeVeryThinSpace;deelnemer: dummy-eight'],
]) {
  test('QA #1528 HTML5 alias independent acceptance rejects ' + name, () => {
    const out = scanNote(markdown)
    assert.equal(out.status, 1, 'missed fictional labelled direct identifier ' + markdown + '\n' + out.output)
    assert.match(out.output, /obvious participant identifier/)
  })
}

test('QA #1528 HTML5 alias independent acceptance preserves safe metadata', () => {
  for (const markdown of [
    '<dt>product&NonBreakingSpace;category</dt><dd>greens</dd>',
    '<th>recipe&VeryThinSpace;name</th><td>bowl</td>',
    '| ingredient&ThickSpace;name | leek |',
    '3. **meal&emsp13;plan** = weekly',
    '> "store&NegativeThinSpace;id": PLUS',
    '**basket&NegativeMediumSpace;source**: manual',
    'retailer&NegativeThickSpace;code = sample',
    'Item&NegativeVeryThinSpace;name: pasta',
    'participantKey: pseudonym-test-123',
    'Policy: never store full&emsp14;name inside these notes.',
  ]) {
    const out = scanNote(markdown)
    assert.equal(out.status, 0, 'benign grocery or policy Markdown was rejected ' + markdown + '\n' + out.output)
  }
})
