import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent synthetic #1528 regression: CommonMark inline emphasis/code spans
// can split an otherwise visible direct-identifier field label. Diagnostic RED
// against frozen #1676; never merge this test alone.
const guardName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const guardPath = fileURLToPath(new URL('./' + guardName, import.meta.url))
function inspect(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-split-markdown-id-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'nested'), { recursive: true })
    copyFileSync(guardPath, join(root, 'tests', guardName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Fictional privacy verification only\n')
    const file = join(root, 'evidence', 'm3', 'nested', 'observation.md')
    writeFileSync(file, note)
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', guardName)], {
      cwd: root, encoding: 'utf8', env, timeout: 20_000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null, 'nested privacy scanner must complete')
    assert.equal(readFileSync(file, 'utf8'), note, 'source evidence bytes must not change')
    return { status: child.status, log: child.stdout + child.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// All field labels render as the recognizable identifier even though
// delimiter syntax splits the raw text. No actual participant information.
const negative = [
  '- parti**cipant**_name: imaginary-person',
  '- participant_**email**: invented-contact',
  '> full *name*: fictitious-person',
  '- account**_id** = synthetic-account',
  '- e-**mail**-adres: invented-contact',
  '| participant_**name** | invented-person |',
  '- parti`cipant`_name: imagined-student',
  '### account_`id`: synthetic-account',
]
for (const [i, note] of negative.entries()) {
  test('QA #1528 expected RED: visible split Markdown identity ' + (i + 1), () => {
    const found = inspect(note)
    assert.equal(found.status, 1, 'scanner overlooked rendered identity ' + JSON.stringify(note) + '\n' + found.log)
    assert.match(found.log, /obvious participant identifier/)
  })
}

// Distinct grocery/policy controls must stay accepted. Source notes are
// verified immutable by inspect() for both accepted and rejected cases.
const benign = [
  '- ingred**ient**_name: tofu',
  '- store_**name**: DekaMarkt',
  '| product *name* | courgette |',
  'Do not publish participant_**name** identifiers.',
  'participantKey: pseudonymous-week-01',
  '- pack_**count** = 2',
  '# Privacy: never collect full *name* or email addresses.',
  '- source_`type`: manual-observation',
]
for (const [i, note] of benign.entries()) {
  test('QA #1528 stable control: benign split Markdown ' + (i + 1), () => {
    const checked = inspect(note)
    assert.equal(checked.status, 0, 'benign text rejected ' + JSON.stringify(note) + '\n' + checked.log)
  })
}
