import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Review-only expected RED against CommonMark's HTML5 named entity rendering.
// The source note is fictitious; no participant or retailer data is touched.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))
function runGuard(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-named-ref-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'synthetic'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic-only\n')
    const path = join(root, 'evidence', 'm3', 'synthetic', 'note.md')
    writeFileSync(path, note)
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    assert.equal(readFileSync(path, 'utf8'), note, 'scanner must never mutate evidence')
    return { status: child.status, log: child.stdout + child.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const disclosures = [
  '- participant&lowbar;name: invented-person',
  '| full&period;name | fictitious-person |',
  '> account&hyphen;id: imaginary-ref',
  '**account&lowbar;email&colon;** fictional-contact',
  'Contact: imaginary&commat;example&period;test',
]
for (const [index, note] of disclosures.entries()) {
  test('QA #1528: deny named HTML entity disclosure ' + (index + 1), () => {
    const result = runGuard(note)
    assert.equal(result.status, 1, 'named entity escaped rendered-field guard: ' + JSON.stringify(note) + '\n' + result.log)
    assert.match(result.log, /obvious participant identifier/)
  })
}

test('QA #1528: named-entity controls without direct IDs remain valid', () => {
  for (const note of [
    '- ingredient name: broccoli &amp; rice',
    '| store name | PLUS &amp; DekaMarkt |',
    'studyId: fictional&hyphen;week-3',
    'Do not record participant&lowbar;name in notes.',
    '- participantKey: invented pseudonym',
  ]) {
    const result = runGuard(note)
    assert.equal(result.status, 0, 'benign text incorrectly rejected: ' + JSON.stringify(note) + '\n' + result.log)
  }
})
