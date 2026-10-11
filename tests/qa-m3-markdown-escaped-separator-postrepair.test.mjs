import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Separate, add-only QA acceptance on immutable DRAFT #1695.
// Execute the real scanner against disposable fictional M3 notes, not user data.
const filename = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const source = fileURLToPath(new URL('./' + filename, import.meta.url))
function check(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-escape-postrepair-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'session'), { recursive: true })
    copyFileSync(source, join(root, 'tests', filename))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Fictional M3 tests only\n')
    const note = join(root, 'evidence', 'm3', 'session', 'note.md')
    writeFileSync(note, markdown, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', filename)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    assert.equal(readFileSync(note, 'utf8'), markdown, 'scanner may not rewrite the evidence note')
    return { code: child.status, output: child.stdout + child.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// Every odd escape renders the following punctuation; even slash runs
// intentionally retain literal slashes and must not be re-interpreted as IDs.
for (const [label, markdown] of [
  ['nested emphasis plus colon', '> - **participant_***name***\\: Fake Student'],
  ['numbered list equals alias', '3. account\\-id\\= fake-account-001'],
  ['direct identity in linked HTML label', '<a href="#privacy">full_name</a>\\: Synthetic Person'],
  ['email hidden in Markdown target', '[synthetic link](https://example.invalid/fake.person\\@example.test)'],
  ['plain escaped email after numeric HTML entity', 'note: fake.person\\@example&#46;test'],
]) {
  test('QA #1528 independent disclosed escaping: ' + label, () => {
    const result = check(markdown + '\n')
    assert.equal(result.code, 1,
      'expected obvious ID rejection: ' + JSON.stringify(markdown) + '\n' + result.output)
    assert.match(result.output, /obvious participant identifier/)
  })
}

for (const [label, markdown] of [
  ['double escaped colon does not render an assignment', 'participant_name\\\\: just illustrative code'],
  ['double escaped at sign is not a literal email', 'contact: fake.person\\\\@example.test'],
  ['triple escaped equals leaves visible backslash', 'full_name\\\\\\= a displayed escape example'],
  ['safe grocery label', '**ingredient_name**\\: broccoli'],
  ['safe pseudonymous ID', 'participantKey\\= demo-pseudonym-7'],
  ['policy text without direct disclosure', '# Policy\nNever collect participant_name\\: or full_name\\= as fields.'],
]) {
  test('QA #1528 independent bounded false-positive control: ' + label, () => {
    const result = check(markdown + '\n')
    assert.equal(result.code, 0,
      'safe text unexpectedly rejected: ' + JSON.stringify(markdown) + '\n' + result.output)
  })
}
