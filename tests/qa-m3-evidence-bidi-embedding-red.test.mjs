import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Independent synthetic bidi-embedding QA against frozen #1748. No real IDs,
// retailers or observation data. Only disposable M3 Markdown is scanned.
const name = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + name, import.meta.url))

function runScanner(note) {
  const dir = mkdtempSync(join(tmpdir(), 'supa-bidi-qa-red-'))
  try {
    mkdirSync(join(dir, 'tests'))
    mkdirSync(join(dir, 'evidence/m3/nested'), { recursive: true })
    copyFileSync(scanner, join(dir, 'tests', name))
    writeFileSync(join(dir, 'evidence/m3/README.md'), '# Synthetic privacy review\n')
    const file = join(dir, 'evidence/m3/nested/note.md')
    writeFileSync(file, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const check = spawnSync(process.execPath, ['--test', join(dir, 'tests', name)], {
      cwd: dir, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(check.error)
    assert.notEqual(check.status, null)
    assert.equal(readFileSync(file, 'utf8'), note, 'scanner never rewrites durable evidence')
    return { code: check.status, text: check.stdout + check.stderr }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

for (const [label, note] of [
  ['raw left-to-right embedding U+202A', '- participant\u202Aname: imaginary-a'],
  ['raw right-to-left embedding U+202B', '**full\u202Bname** = fictional-b'],
  ['numeric pop-directional-format U+202C', '> account&#x202C;email: sample-c'],
  ['numeric left-to-right override U+202D', '<dt>participant&#8237;email</dt><dd>synthetic-d</dd>'],
  ['raw right-to-left override U+202E', '<th>account\u202Eid</th><td>fake-e</td>'],
  ['format mark inside a fictional email address', 'contact: invented@example\u202A.test'],
]) {
  test('QA #1737 expected RED: bidirectional controls may not hide ' + label, () => {
    const result = runScanner(note)
    assert.equal(result.code, 1, 'obvious synthetic ID hidden by bidi format control: ' + label + '\n' + result.text)
    assert.match(result.text, /obvious participant identifier/)
  })
}

test('QA #1737 safe controls: bidi formatting in nonpersonal grocery fields is allowed', () => {
  for (const note of [
    '- product\u202Aname: pear',
    '**recipe\u202Bname** = oats',
    '> ingredient&#x202C;unit: ml',
    '<dt>basket&#8237;source</dt><dd>fixture</dd>',
    '<th>store\u202Eid</th><td>synthetic</td>',
    'participantKey: pseudonymous-week-4',
    'Policy: avoid collecting real names, addresses and emails.',
  ]) {
    const result = runScanner(note)
    assert.equal(result.code, 0, 'legitimate shopping metadata rejected: ' + note + '\n' + result.text)
  }
})
