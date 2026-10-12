import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Separate postrepair boundary acceptance: all names/values are invented.
// The scanner executes in a disposable copy with its own nested M3 note.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const source = fileURLToPath(new URL('./' + scannerName, import.meta.url))
function check(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-html-semantics-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    const nested = join(root, 'evidence', 'm3', 'independent', 'nested')
    mkdirSync(nested, { recursive: true })
    copyFileSync(source, join(root, 'tests', scannerName))
    const readme = join(root, 'evidence', 'm3', 'README.md')
    writeFileSync(readme, '# Fictitious acceptance root\n')
    const note = join(nested, 'observation.md')
    writeFileSync(note, markdown)
    const environment = { ...process.env }
    delete environment.NODE_TEST_CONTEXT
    const subprocess = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env: environment, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(subprocess.error)
    assert.notEqual(subprocess.status, null, 'scanner was interrupted')
    assert.equal(readFileSync(note, 'utf8'), markdown, 'scanner changed original evidence')
    return {
      passed: subprocess.status === 0,
      output: (subprocess.stdout || '') + (subprocess.stderr || ''),
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [context, markdown] of [
  ['data element within strong list field', '- **participant<data value="x">_name</data>**: invented-a'],
  ['time element inside quoted field', '> "full<time datetime="2026-10-12">name</time>": invented-b'],
  ['label element inside table header', '<th><label>participant</label>email</th><td>invented-c</td>'],
  ['output element inside HTML definition', '<dt>account<output>id</output></dt><dd><strong>invented-d</strong></dd>'],
  ['samp element in Markdown table', '| account<samp>email</samp> | invented-e |'],
  ['bdi element in numbered list', '2. participant<bdi>name</bdi>: invented-f'],
]) {
  test('QA #1737 independent semantic HTML acceptance: ' + context, () => {
    const result = check(markdown)
    assert.equal(result.passed, false, 'obvious field not detected: ' + markdown + '\n' + result.output)
    assert.match(result.output, /obvious participant identifier/)
  })
}

test('QA #1737 preserve legitimate M3 metadata with visible semantics', () => {
  for (const markdown of [
    '- **ingredient<data value="x">_name</data>**: cauliflower',
    '> "recipe<time datetime="2026-10-12">date</time>": Tuesday',
    '<th><label>store</label>name</th><td>Demo PLUS</td>',
    '<dt>basket<output>id</output></dt><dd><strong>synthetic-one</strong></dd>',
    '| grocery<samp>label</samp> | courgette |',
    '2. product<bdi>name</bdi>: chicken',
    'participantKey: pseudo-test-case-b',
    'Policy: exclude actual participant identifiers from all M3 notes.',
  ]) {
    const result = check(markdown)
    assert.equal(result.passed, true, 'safe metadata rejected: ' + markdown + '\n' + result.output)
  }
})
