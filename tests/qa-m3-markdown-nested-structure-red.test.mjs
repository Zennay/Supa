import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent black-box privacy regression against the real M3 Markdown scanner.
// Every note and value below is synthetic; real field evidence is never touched.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scannerPath = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function runRealScanner(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-nested-marker-'))
  try {
    const testsDir = join(root, 'tests')
    const evidenceDir = join(root, 'evidence', 'm3')
    mkdirSync(testsDir, { recursive: true })
    mkdirSync(evidenceDir, { recursive: true })
    copyFileSync(scannerPath, join(testsDir, scannerName))
    writeFileSync(join(evidenceDir, 'README.md'), '# Synthetic evidence only\n')
    writeFileSync(join(evidenceDir, 'note.md'), note + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT // Nested node:test must run, not silently skip.
    const child = spawnSync(process.execPath, ['--test', join(testsDir, scannerName)], {
      cwd: root,
      encoding: 'utf8',
      timeout: 20000,
      env,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null, 'the child scanner must exit')
    assert.match(
      child.stdout + child.stderr,
      /QA M3: every committed Markdown evidence note forbids obvious personal identifiers/,
      'the actual durable Markdown privacy test must execute',
    )
    return child
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// A Markdown blockquote, bullet or heading may nest another Markdown marker.
// These are direct-identifier FIELD declarations, not descriptive policy prose.
const forbidden = [
  ['nested blockquote', '> > participantName: Synthetic Value'],
  ['adjacent nested quote with quoted key', '>> "participant_email": "synthetic-value"'],
  ['heading containing blockquote', '## > Full Name: Synthetic Student'],
  ['list item containing blockquote', '- > accountId = synthetic-account'],
  ['blockquote/list/blockquote chain', '> - > accountEmail: synthetic-value'],
  ['list item containing a heading', '- ### **Participant Name**: Synthetic Student'],
]

for (const [label, note] of forbidden) {
  test('M3 privacy: nested Markdown structure rejects ' + label, () => {
    const child = runRealScanner(note)
    assert.equal(
      child.status, 1,
      'nested direct identifier evaded the real scanner:\n' +
        note + '\n' + child.stdout + '\n' + child.stderr,
    )
    assert.match(child.stdout + child.stderr, /obvious participant identifier/)
  })
}

test('M3 privacy: nested benign metadata, ordinary headings and policy prose stay valid', () => {
  const allowed = [
    '> > participantKey: synthetic-pseudonym',
    '## > studyId: synthetic-m3-week',
    '- > Product name: Broccoli',
    '> - > Store name: PLUS',
    '- ### Evidence rules: no participant names or account information',
    '# M3 evidence\nNo direct personal identifiers belong in evidence.',
  ]
  for (const note of allowed) {
    const child = runRealScanner(note)
    assert.equal(
      child.status, 0,
      'benign Markdown note rejected:\n' + note + '\n' + child.stdout + '\n' + child.stderr,
    )
  }
})
