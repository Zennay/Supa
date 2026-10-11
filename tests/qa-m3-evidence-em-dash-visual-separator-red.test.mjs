import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Independent expected-RED: synthetic explicit labels only, no real identities.
// Run the actual M3 guard on private, disposable nested Markdown; preserve bytes.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-em-dash-red-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence/m3/temporary/notes'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence/m3/README.md'), '# Fictional field note controls\n')
    const path = join(root, 'evidence/m3/temporary/notes/fictional.md')
    writeFileSync(path, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null)
    assert.equal(readFileSync(path, 'utf8'), note, 'no mutation of committed evidence bytes')
    return { status: result.status, logs: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [description, markdown] of [
  ['raw EM DASH in participant-name list', '- participant\u2014name: invented-one'],
  ['raw HORIZONTAL BAR in account-id heading', '## account\u2015id = invented-two'],
  ['SMALL EM DASH in full-name table', '| full\ufe58name | invented-three |'],
  ['numeric hex EM DASH in Dutch identifier', '<dt>naam&#x2014;deelnemer</dt><dd>invented-four</dd>'],
  ['decimal HORIZONTAL BAR in account-email quote', '> account&#8213;email: invented-five'],
  ['HTML named mdash in full-name inline label', '**full&mdash;name**: invented-six'],
  ['HTML named horbar in participant-email label', 'participant&horbar;email: invented-seven'],
]) {
  test('QA #1737 expected RED: ' + description, () => {
    const result = scan(markdown)
    assert.equal(result.status, 1, 'visually obvious fictional direct identifier missed: ' + description + '\n' + result.logs)
    assert.match(result.logs, /obvious participant identifier/)
  })
}

test('QA #1737 controls: visual punctuation in safe grocery and policy fields is allowed', () => {
  for (const note of [
    'ingredient\u2014name: broccoli',
    '| store\u2015name | fictional shop |',
    'recipe\ufe58name: lentils',
    '- budget&#x2014;note: unknown',
    '> basket&#8213;price: unknown',
    '**product&mdash;name**: cauliflower',
    'source&horbar;context: manual testing',
    'participantKey: pseudonymous-not-a-person',
    'No names or direct emails are committed in evidence.',
  ]) {
    const result = scan(note)
    assert.equal(result.status, 0, 'safe fictitious note rejected: ' + note + '\n' + result.logs)
  }
})
