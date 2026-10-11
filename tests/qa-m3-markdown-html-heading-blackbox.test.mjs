import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Synthetic black-box tests execute the actual canonical M3 Markdown scanner.
// No real participant, retailer or evidence data is copied or modified.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scannerPath = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-markdown-html-'))
  try {
    const testDir = join(root, 'tests')
    const evidenceDir = join(root, 'evidence', 'm3')
    mkdirSync(testDir, { recursive: true })
    mkdirSync(evidenceDir, { recursive: true })
    copyFileSync(scannerPath, join(testDir, scannerName))
    writeFileSync(join(evidenceDir, 'README.md'), '# Synthetic M3 evidence privacy contract\n')
    writeFileSync(join(evidenceDir, 'sample.md'), note + '\n', 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT // nested node:test must actually run
    const child = spawnSync(process.execPath, ['--test', join(testDir, scannerName)], {
      env, encoding: 'utf8', timeout: 20000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null, 'nested scanner must finish')
    assert.match(child.stdout + child.stderr, /QA M3: every committed Markdown evidence note/)
    return child
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, note] of [
  ['HTML paragraph participant name', '<p>participant_name: Synthetic Student</p>'],
  ['HTML div account ID', '<div class="metadata">account-id = synthetic-001</div>'],
  ['HTML list item full name', '<li>Full Name: Synthetic Student</li>'],
  ['HTML span participant email', '<span>participantEmail: synthetic-only-value</span>'],
  ['Markdown heading participant name', '### participant_name: Synthetic Student'],
]) {
  test('QA M3 Markdown scanner rejects ' + label, () => {
    const child = scan(note)
    assert.equal(child.status, 1,
      'An obvious labelled identifier escaped the durable Markdown scanner: ' + label +
      '\nstdout:\n' + child.stdout + '\nstderr:\n' + child.stderr)
    assert.match(child.stdout + child.stderr, /obvious participant identifier/)
  })
}

test('QA M3 Markdown scanner keeps ordinary HTML and heading metadata allowed', () => {
  for (const note of [
    '<p>participantKey: synthetic-pseudonym-001</p>',
    '<div>Product name: Broccoli</div>',
    '<li>Store name: PLUS</li>',
    '### Privacy contract: do not commit names or email addresses',
  ]) {
    const child = scan(note)
    assert.equal(child.status, 0, child.stdout + '\n' + child.stderr)
  }
})
