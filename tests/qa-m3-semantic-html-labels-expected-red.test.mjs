import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Isolated add-only expected-RED probe for visible HTML5 phrasing.
// Invented non-person values only; no genuine M3 observation is inspected.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function scanPrivateMarkdown(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-visible-semantic-'))
  try {
    mkdirSync(join(root, 'tests'))
    const evidence = join(root, 'evidence', 'm3', 'private', 'nested')
    mkdirSync(evidence, { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    const marker = join(root, 'evidence', 'm3', 'README.md')
    writeFileSync(marker, '# Synthetic privacy contract\n')
    const note = join(evidence, 'case.md')
    writeFileSync(note, markdown)
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null, 'guard never exited')
    assert.equal(readFileSync(note, 'utf8'), markdown, 'source evidence bytes changed')
    return { passed: result.status === 0, output: (result.stdout || '') + (result.stderr || '') }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, markdown] of [
  ['HTML data element in list label', '- participant<data value="canonical">name</data>: fake-value-a'],
  ['HTML time element in quoted label', '> account<time datetime="2026-10-12">email</time>: fake-value-b'],
  ['HTML label element in Markdown table', '| full<label>name</label> | fake-value-c |'],
  ['HTML output element in definition list', '<dt>participant<output>name</output></dt><dd>fake-value-d</dd>'],
  ['HTML samp element in header cells', '<th>account<samp>id</samp></th><td>fake-value-e</td>'],
  ['HTML bdi element inside quoted field', '"participant<bdi>email</bdi>": fake-value-f'],
]) {
  test('QA #1737 semantic HTML visible label expected RED: ' + label, () => {
    const result = scanPrivateMarkdown(markdown)
    assert.equal(result.passed, false, 'visible direct-ID label missed: ' + markdown + '\n' + result.output)
    assert.match(result.output, /obvious participant identifier/)
  })
}

test('QA #1737 semantic HTML safe grocery, pseudo-ID and policy controls', () => {
  for (const markdown of [
    '- ingredient<data value="code">name</data>: broccoli',
    '> basket<time datetime="2026-10-12">date</time>: demo',
    '| store<label>name</label> | PLUS demo |',
    '<dt>recipe<output>name</output></dt><dd>tikka demo</dd>',
    '<th>plan<samp>id</samp></th><td>week-1</td>',
    '"product<bdi>name</bdi>": rice',
    'participantKey: study-pseudonym-0001',
    'Policy: never commit direct participant names or email addresses.',
  ]) {
    const result = scanPrivateMarkdown(markdown)
    assert.equal(result.passed, true, 'harmless metadata rejected: ' + markdown + '\n' + result.output)
  }
})
