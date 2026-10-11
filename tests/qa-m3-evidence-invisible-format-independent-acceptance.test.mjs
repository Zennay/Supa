import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Independent novel acceptance on frozen #1747, not a repetition of RED data.
// Fixture identity strings, stores and groceries below are wholly invented.
const filename = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const source = fileURLToPath(new URL('./' + filename, import.meta.url))

function validateNote(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-qa-invisible-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence/m3/independent'), { recursive: true })
    copyFileSync(source, join(root, 'tests', filename))
    writeFileSync(join(root, 'evidence/m3/README.md'), '# Fabricated evidence boundary\n')
    const path = join(root, 'evidence/m3/independent/note.md')
    writeFileSync(path, markdown)
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const run = spawnSync(process.execPath, ['--test', join(root, 'tests', filename)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(run.error)
    assert.notEqual(run.status, null)
    assert.equal(readFileSync(path, 'utf8'), markdown, 'source note must remain byte-exact')
    return { exitCode: run.status, diagnostic: run.stdout + run.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [title, note] of [
  ['raw initial variation selector', 'account\uFE00id: madeup-a'],
  ['raw inner variation selector', 'participant\uFE05email = fictitious-b'],
  ['numeric VS15 in Markdown quote', '> full&#xFE0E;name: synthetic-c'],
  ['decimal VS16 in Dutch list', '- naam&#65039;deelnemer: sample-d'],
  ['numeric Arabic Letter Mark in HTML definition', '<dt>participant&#x61C;name</dt><dd>dummy-e</dd>'],
  ['raw combining grapheme joiner in strong label', '**account\u034Fid** = test-f'],
  ['numeric Mongolian Vowel Separator in HTML table', '<th>account&#6158;email</th><td>fiction-g</td>'],
  ['raw invisible mark inside fake contact email', 'fake\u034Fname@example.test'],
]) {
  test('QA #1737 independent acceptance: ' + title, () => {
    const result = validateNote(note)
    assert.equal(result.exitCode, 1, 'fictional ID escaped guard: ' + title + '\n' + result.diagnostic)
    assert.match(result.diagnostic, /obvious participant identifier/)
  })
}

test('QA #1737 independent acceptance: allow unrelated shopping metadata and policy text', () => {
  for (const note of [
    'product\uFE00name: green pepper',
    'recipe\uFE05id = bowl-004',
    '> store&#xFE0E;location: fixture-city',
    '- ingredient&#65039;quantity: 450g',
    '<dt>basket&#x61C;source</dt><dd>local</dd>',
    '**meal\u034Fplan**: Tuesday',
    '<th>catalog&#6158;version</th><td>v1</td>',
    'participantKey: study-pseudonym-005',
    'Safety guidance: do not commit names or account emails.',
  ]) {
    const result = validateNote(note)
    assert.equal(result.exitCode, 0, 'legitimate review metadata blocked: ' + note + '\n' + result.diagnostic)
  }
})
