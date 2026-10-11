import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent expected RED against frozen #1712. Fictional values only.
// Actual M3 guard scans a disposable nested evidence directory, not live data.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))
function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-named-invisible-red-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'fictional'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic evidence policy\n')
    const path = join(root, 'evidence', 'm3', 'fictional', 'note.md')
    writeFileSync(path, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    assert.equal(readFileSync(path, 'utf8'), note, 'scan must preserve note bytes')
    return { status: child.status, output: child.stdout + child.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// These HTML5 named references render no visible character and break the
// existing field/email patterns in the checked Markdown scan copy.
for (const [label, note] of [
  ['named zero-width space', '- participant&ZeroWidthSpace;_name: invented-person'],
  ['named zero-width nonjoiner', '> account&zwnj;_id = fictional-id'],
  ['named zero-width joiner in email', 'Email: madeup@exam&zwj;ple.test'],
  ['named soft hyphen in field', 'full&shy; name: synthetic-user'],
  ['named no-break in table', '| participant&NoBreak;_email | invented-value |'],
  ['named left-to-right mark', '1. account&lrm;-email: fictional-contact'],
  ['named right-to-left mark in recipient', '[contact](mailto:fake@exam&rlm;ple.test)'],
]) {
  test('QA #1528 rejects named invisible HTML identity: ' + label, () => {
    const r = scan(note)
    assert.equal(r.status, 1, 'missed synthetic disclosure ' + JSON.stringify(note) + '\n' + r.output)
    assert.match(r.output, /obvious participant identifier/)
  })
}

test('QA #1528 named-entity scanner permits harmless prose, grocery and metadata', () => {
  for (const note of [
    '- ingredient&ZeroWidthSpace;_name: pasta',
    'Store: PLUS&zwnj; Amsterdam',
    'Never include participant&shy;_name in evidence.',
    'A harmless line: &copy; is a named reference.',
    'participantKey: fictional-pseudonymous-01',
    '| store&NoBreak;_name | DekaMarkt |',
  ]) {
    const r = scan(note)
    assert.equal(r.status, 0, 'false positive ' + JSON.stringify(note) + '\n' + r.output)
  }
})
