import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Test-only independent regression for #1528: linked field labels must be
// inspected without erasing email addresses present in link destinations.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-mailto-acceptance-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'review'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic privacy policy\n')
    const notePath = join(root, 'evidence', 'm3', 'review', 'note.md')
    writeFileSync(notePath, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    assert.equal(readFileSync(notePath, 'utf8'), note, 'original note must not change')
    return { status: child.status, output: child.stdout + child.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('QA #1528: URL destinations containing fictional emails remain visible before link normalization', () => {
  for (const note of [
    '[contact](mailto:fictional.person@example.test)',
    '2. [Private ref](https://example.invalid/fictional.person@example.test)',
    '<a href="mailto:madeup@example.test">contact</a>',
    '- [Contact instructions](mailto:madeup@example.test)',
  ]) {
    const actual = scan(note)
    assert.equal(actual.status, 1, 'email hidden inside link target: ' + JSON.stringify(note) + '\n' + actual.output)
    assert.match(actual.output, /obvious participant identifier/)
  }
})

test('QA #1528: non-identifying links remain permitted without losing linked field restrictions', () => {
  for (const note of [
    '[Contact policy](#policy) describes why email must not be retained.',
    '[Store description](https://example.invalid/store) = local shop',
    '<a href="#privacy">Privacy notes</a>',
    '- [participantKey](#pseudonym): student-pseudo-001',
  ]) {
    const actual = scan(note)
    assert.equal(actual.status, 0, 'benign link unexpectedly refused: ' + JSON.stringify(note) + '\n' + actual.output)
  }
})
