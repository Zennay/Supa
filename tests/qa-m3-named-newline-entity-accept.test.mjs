import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent add-only postrepair QA #1528 acceptance for named HTML5 &NewLine;.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))
function evaluate(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-named-newline-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'a', 'b'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Fictional evidence policy\n')
    const target = join(root, 'evidence', 'm3', 'a', 'b', 'note.md')
    writeFileSync(target, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null)
    assert.equal(readFileSync(target, 'utf8'), note, 'evidence must remain byte-for-byte unchanged')
    return { status: result.status, output: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, markdown] of [
  ['bold name label', '- **full&NewLine;name** = fake-person'],
  ['quoted participant contact', '> "participant&NewLine;email": made-up-contact'],
  ['HTML heading and table value', '<th>account&NewLine;id</th><td>fictional-key</td>'],
  ['definition term and data', '<dt>full&NewLine;name</dt><dd>imaginary</dd>'],
  ['Dutch numbered email label', '2. e&NewLine;mail&NewLine;adres: invented-contact'],
  ['Markdown table account email', '| account&NewLine;email | fictitious-email-key |'],
]) {
  test('QA #1528 independent named NewLine acceptance blocks direct ID: ' + label, () => {
    const result = evaluate(markdown)
    assert.equal(result.status, 1, 'missed synthetic disclosure ' + JSON.stringify(markdown) + '\n' + result.output)
    assert.match(result.output, /obvious participant identifier/)
  })
}

test('QA #1528 independent named NewLine acceptance allows harmless documentation', () => {
  for (const markdown of [
    '- ingredient&NewLine;name: spinach',
    '> Store&NewLine;id: PLUS',
    '<th>recipe&NewLine;name</th><td>Curry</td>',
    '<dt>product&NewLine;category</dt><dd>Frozen food</dd>',
    '2. meal&NewLine;plan: dinner',
    'participantKey: pseudonym-012',
    'Policy text: avoid full&NewLine;name disclosures in Git.',
    'M3 records observed baskets, never email addresses.',
  ]) {
    const result = evaluate(markdown)
    assert.equal(result.status, 0, 'false positive on benign note ' + JSON.stringify(markdown) + '\n' + result.output)
  }
})
