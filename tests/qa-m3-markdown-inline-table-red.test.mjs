import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent add-only RED against the real M3 Markdown evidence privacy guard.
// Synthetic metadata only; never inspect or change genuine M3 participant evidence.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scannerPath = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function runRealScanner(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-inline-table-red-'))
  try {
    const testsDir = join(root, 'tests')
    const evidenceDir = join(root, 'evidence', 'm3')
    mkdirSync(testsDir, { recursive: true })
    mkdirSync(evidenceDir, { recursive: true })
    copyFileSync(scannerPath, join(testsDir, scannerName))
    writeFileSync(join(evidenceDir, 'README.md'), '# Synthetic evidence only\n')
    writeFileSync(join(evidenceDir, 'case.md'), markdown + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT // A nested node:test must execute, not silently skip.
    const child = spawnSync(process.execPath, ['--test', join(testsDir, scannerName)], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 20000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null, 'nested scanner exited')
    assert.match(
      child.stdout + child.stderr,
      /QA M3: every committed Markdown evidence note forbids obvious personal identifiers/,
      'real guard must execute in disposable child repository',
    )
    return child
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// Backtick and underscore delimiters are visual Markdown wrappers, not part of
// a direct-identifier field. This case is distinct from heading/quote nesting.
const forbidden = [
  ['inline-code participant name', '| `participantName` | Synthetic Student |'],
  ['underscore account identifier', '| __accountId__ | synthetic-account |'],
  ['nested inline-code email alias', '> | `participant_email` | synthetic-value |'],
  ['quoted underscore account email', '> > | __accountEmail__ | synthetic-value |'],
  ['list + inline-code full name', '- | `Full Name` | Synthetic Student |'],
  ['fullwidth code-wrapped account ID', '> - | ｀ａｃｃｏｕｎｔ－ｉｄ｀ | synthetic-value |'],
]

for (const [label, markdown] of forbidden) {
  test('QA M3 table inline-format rejects ' + label, () => {
    const child = runRealScanner(markdown)
    assert.equal(child.status, 1,
      'obvious direct identifier passed the real scanner:\n' +
        markdown + '\n' + child.stdout + '\n' + child.stderr)
    assert.match(child.stdout + child.stderr, /obvious participant identifier/)
  })
}

test('QA M3 table inline-format allows benign metadata and prose', () => {
  for (const markdown of [
    '| `participantKey` | synthetic-pseudonym |',
    '> | __studyId__ | synthetic-week |',
    '> - | `Product name` | Broccoli |',
    '| __Store name__ | PLUS |',
    '> | `Field` | policy meaning |',
    'Privacy rules: do not place participant names or account IDs in tables.',
  ]) {
    const child = runRealScanner(markdown)
    assert.equal(child.status, 0,
      'benign Markdown note rejected:\n' +
        markdown + '\n' + child.stdout + '\n' + child.stderr)
  }
})
