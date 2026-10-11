import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Issue #1528: exercise the actual committed privacy scanner in a disposable
// repository. All labels and values are synthetic, never participant data.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scannerPath = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-inline-table-'))
  try {
    const testsDir = join(root, 'tests')
    const evidenceDir = join(root, 'evidence', 'm3')
    mkdirSync(testsDir, { recursive: true })
    mkdirSync(evidenceDir, { recursive: true })
    copyFileSync(scannerPath, join(testsDir, scannerName))
    writeFileSync(join(evidenceDir, 'README.md'), '# Synthetic M3 evidence only\n')
    writeFileSync(join(evidenceDir, 'case.md'), note + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(testsDir, scannerName)], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 20000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    assert.match(child.stdout + child.stderr,
      /QA M3: every committed Markdown evidence note forbids obvious personal identifiers/)
    return child
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const unsafe = [
  ['underscored name', '| __participantName__ | Synthetic Student |'],
  ['inline-code email label', '| `participantEmail` | synthetic-value |'],
  ['quoted name', '| "fullName" | Synthetic Student |'],
  ['nested underscored account label', '> - | __account-id__ | synthetic-value |'],
  ['nested inline-code name', '> > | `participant-name` | Synthetic Student |'],
]

for (const [description, note] of unsafe) {
  test('QA M3 Markdown table rejects ' + description, () => {
    const child = scan(note)
    assert.equal(child.status, 1,
      'direct-ID table label escaped privacy scanner: ' + note +
      '\n' + child.stdout + '\n' + child.stderr)
    assert.match(child.stdout + child.stderr, /obvious participant identifier/)
  })
}

test('QA M3 table privacy retains safe decorated pseudonyms and normal labels', () => {
  for (const note of [
    '| __participantKey__ | synthetic-pseudonym |',
    '| `studyId` | synthetic-week |',
    '| "Store name" | PLUS |',
    '> | __Product name__ | Broccoli |',
    '# Privacy policy\nNever store direct names or contact details.',
    '| **participantName** | Synthetic Student |',
  ]) {
    const child = scan(note)
    const isKnownUnsafeControl = note.includes('**participantName**')
    assert.equal(child.status, isKnownUnsafeControl ? 1 : 0,
      'unexpected scanner result for ' + note +
      '\n' + child.stdout + '\n' + child.stderr)
  }
})
