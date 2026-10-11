import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent QA #1528 postrepair proof: different fictitious Markdown/HTML
// cases from the RED probe, never any real identity or retailer observation.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function verify(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-html-named-space-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'nested', 'deeper'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Fictitious study policy\n')
    const target = join(root, 'evidence', 'm3', 'nested', 'deeper', 'note.md')
    writeFileSync(target, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const run = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(run.error)
    assert.notEqual(run.status, null)
    assert.equal(readFileSync(target, 'utf8'), note, 'source Markdown bytes are immutable')
    return { status: run.status, output: run.stdout + run.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, note] of [
  ['different medium-space personal name', '> **full&MediumSpace;name** = invented-alpha'],
  ['HTML definition participant email', '<dt>participant&emsp;email</dt><dd>dummy-bravo</dd>'],
  ['different ThinSpace HTML table', '<th>account&ThinSpace;id</th><td>fictional-charlie</td>'],
  ['en-space Dutch definition', '<dt>naam&ensp;deelnemer</dt><dd>imaginary-delta</dd>'],
  ['hair/figure-space Dutch email', '3. e&hairsp;mail&numsp;adres: fake-echo'],
  ['punctuation-space explicit name', '| full&puncsp;name | placeholder-foxtrot |'],
]) {
  test('QA #1528 independent named-space acceptance blocks ' + label, () => {
    const result = verify(note)
    assert.equal(result.status, 1, 'scanner missed fictitious identity label: ' + note + '\n' + result.output)
    assert.match(result.output, /obvious participant identifier/)
  })
}

test('QA #1528 named-space acceptance permits benign Markdown and pseudonymous metadata', () => {
  for (const note of [
    '- recipe&MediumSpace;name: courgette soup',
    '<li>product&emsp;category: grocery</li>',
    '<th>store&ThinSpace;id</th><td>DekaMarkt</td>',
    '<dt>basket&ensp;provenance</dt><dd>manual-test</dd>',
    '3. meal&hairsp;name: breakfast',
    '| purchase&puncsp;unit | gram |',
    'participantKey: invented-session-key',
    'Policy: never publish full&numsp;name fields in M3.',
    'Collection policy mentions emails, not actual email addresses.',
  ]) {
    const result = verify(note)
    assert.equal(result.status, 0, 'false positive on harmless text: ' + note + '\n' + result.output)
  }
})
