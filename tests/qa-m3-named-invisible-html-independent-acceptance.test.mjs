import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent black-box acceptance on QA #1528. All values are imaginary.
// The actual privacy scanner runs in a throwaway nested M3 tree. Never
// inspect live M3 participant notes or mutate the synthetic source bytes.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))
function check(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-named-entity-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'nested', 'review'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic M3 evidence policy\n')
    const path = join(root, 'evidence', 'm3', 'nested', 'review', 'note.md')
    writeFileSync(path, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    assert.equal(readFileSync(path, 'utf8'), note, 'original evidence bytes must remain unchanged')
    return { status: child.status, output: child.stdout + child.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, note] of [
  ['zero-width name inside linked label', '- [participant&ZeroWidthSpace;_name](#note): fictional-value'],
  ['soft hyphen in table identifier', '| account&shy;_id | madeup-key |'],
  ['zero-width nonjoiner in quoted key', '"full&zwnj; name" = imaginary-name'],
  ['zero-width joiner in HTML cell label', '<td>participant&zwj;_email</td><td>example-contact</td>'],
  ['no-break inside numbered list', '4. account&NoBreak;_email: synthetic-data'],
  ['left-to-right mark in email target', '[contact](mailto:imaginary@exa&lrm;mple.test)'],
  ['right-to-left mark inside email', 'Email: fictional@exam&rlm;ple.test'],
]) {
  test('QA #1528 independent acceptance rejects named invisible identity: ' + label, () => {
    const r = check(note)
    assert.equal(r.status, 1, 'missed fictional identifier ' + JSON.stringify(note) + '\n' + r.output)
    assert.match(r.output, /obvious participant identifier/)
  })
}

test('QA #1528 independent acceptance permits safe field labels and descriptions', () => {
  for (const note of [
    '- ingredient&ZeroWidthSpace;_name: broccoli',
    'Store: PLUS &NoBreak; supermarket',
    'Shopping note: add a small &shy; loaf.',
    'Never record participant&ZeroWidthSpace;_email in M3 evidence.',
    '| store&zwj;_name | DekaMarkt |',
    'participantKey: student-pseudonymous-001',
    'A harmless HTML named reference: &copy; is copyright.',
    'The word &lrm; is a formatting reference in this explanation.',
  ]) {
    const r = check(note)
    assert.equal(r.status, 0, 'false positive on safe note ' + JSON.stringify(note) + '\n' + r.output)
  }
})
