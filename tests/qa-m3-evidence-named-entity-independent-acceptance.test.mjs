import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Postrepair black-box quality acceptance with fictional content only.
const file = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + file, import.meta.url))
function inspect(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-named-entity-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'synthetic'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', file))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic data only\n')
    const path = join(root, 'evidence', 'm3', 'synthetic', 'note.md')
    writeFileSync(path, note)
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', file)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null, 'child scanner must execute')
    assert.equal(readFileSync(path, 'utf8'), note, 'original note unchanged')
    return { status: result.status, log: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('QA #1528: independent named character-reference fields must be rejected', () => {
  for (const note of [
    '- participant&lowbar;email&colon; fake-contact',
    '- account&hyphen;id&equals; fictional-account',
    '| full&nbsp;name | invented-person |',
    '1. participant&Tab;name: fictional-person',
    '- account&lowbar;email: invented-recipient',
  ]) {
    const result = inspect(note)
    assert.equal(result.status, 1, 'identity field hidden via HTML entity: ' + JSON.stringify(note) + '\n' + result.log)
    assert.match(result.log, /obvious participant identifier/)
  }
})

test('QA #1528: independent named mail target and plain email controls stay protected', () => {
  for (const note of [
    'invented&commat;example&period;test',
    '[Contact](mailto:invented&commat;example.test)',
    '<a href="https://example.invalid/?contact=invented&commat;example.test">Policy</a>',
  ]) {
    const result = inspect(note)
    assert.equal(result.status, 1, 'named entity email concealed: ' + JSON.stringify(note) + '\n' + result.log)
    assert.match(result.log, /obvious participant identifier/)
  }
})

test('QA #1528: named policy, shopping and pseudonymous data remain allowed', () => {
  for (const note of [
    '- ingredient name: broccoli &amp; lentils',
    '- store name: PLUS &amp; DekaMarkt',
    '- studyId: fabricated&hyphen;week',
    'Avoid writing participant&lowbar;name in human observations.',
    'participantKey: pseudonymous-student-001',
    '- unit: g &sol; kg',
    '[privacy policy](https://example.invalid/?view=account&equals;settings)',
  ]) {
    const result = inspect(note)
    assert.equal(result.status, 0, 'benign evidence flagged: ' + JSON.stringify(note) + '\n' + result.log)
  }
})
