import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Synthetic-only independent gate acceptance on frozen #1689.
// A CommonMark punctuation escape renders as the visible punctuation,
// but the bounded text backstop currently sees the raw backslash.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function scan(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-separator-red-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'notes'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Fake QA examples only\n')
    const file = join(root, 'evidence', 'm3', 'notes', 'fixture.md')
    writeFileSync(file, markdown, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath,
      ['--test', join(root, 'tests', scannerName)],
      { cwd: root, env, encoding: 'utf8', timeout: 20_000 })
    assert.ifError(child.error)
    assert.notEqual(child.status, null, 'real scanner process must finish')
    assert.equal(readFileSync(file, 'utf8'), markdown, 'evidence bytes must not be rewritten')
    return { status: child.status, output: child.stdout + child.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const reject = [
  ['escaped colon after bare label', '- participant_name\\: fictional-person'],
  ['escaped equals after emphasized label', '**account-id**\\= fictional-001'],
  ['escaped colon after linked field', '> [full_name](#fake)\\: Fictional User'],
  ['escaped equals after Unicode-width alias', 'ｐａｒｔｉｃｉｐａｎｔ＿ｅｍａｉｌ\\= fictional-value'],
  ['escaped at-sign in plain text email', 'contact: fictional.person\\@example.test'],
  ['escaped at-sign in link target', '[contact](mailto:fictional.person\\@example.test)'],
]

for (const [name, note] of reject) {
  test('QA #1528 expected RED: ' + name, () => {
    const result = scan(note + '\n')
    assert.equal(result.status, 1,
      'visible disclosure missed by real scanner: ' + JSON.stringify(note) + '\n' + result.output)
    assert.match(result.output, /obvious participant identifier/)
  })
}

for (const [name, note] of [
  ['policy-only alias', 'Do not record participant_name\\: this is only guidance.'],
  ['pseudonymous key', '- participantKey\\: synthetic-code-01'],
  ['non-private shopping label', '**ingredient_name**\\= broccoli'],
  ['safe link reference', '- [store_name](#store)\\: Fictional Grocer'],
  ['safe URI', '[catalog](https://example.invalid/products)'],
  ['non-identity faux email fragment', 'Store URL uses fictional\\@host without a top-level domain.'],
]) {
  test('QA #1528 benign escape control: ' + name, () => {
    const result = scan(note + '\n')
    assert.equal(result.status, 0,
      'false positive from real scanner: ' + JSON.stringify(note) + '\n' + result.output)
  })
}
