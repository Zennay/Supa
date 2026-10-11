import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent postrepair test, invoking the real guard on synthetic notes only.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function check(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-inline-postrepair-'))
  try {
    const dir = join(root, 'tests')
    const evidence = join(root, 'evidence', 'm3')
    mkdirSync(dir, { recursive: true })
    mkdirSync(evidence, { recursive: true })
    copyFileSync(scanner, join(dir, scannerName))
    writeFileSync(join(evidence, 'README.md'), '# Synthetic contract\n')
    writeFileSync(join(evidence, 'case.md'), note + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(dir, scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    assert.match(child.stdout + child.stderr,
      /QA M3: every committed Markdown evidence note forbids obvious personal identifiers/,
      'child node:test scanner actually executes')
    return child
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const forbidden = [
  ['underscore fullName', '| __fullName__ | Synthetic Student |'],
  ['code wrapped account-email alias', '| `account_email` | synthetic-value |'],
  ['Dutch underscored name', '| __naam-deelnemer__ | Synthetic Student |'],
  ['quoted inline-code email address', '> | `email_address` | synthetic-value |'],
  ['Unicode normalized inline-code account ID', '> > | `ａｃｃｏｕｎｔＩｄ` | synthetic-value |'],
  ['existing bold table detection stays intact', '| **participant_name** | Synthetic Student |'],
]

for (const [label, note] of forbidden) {
  test('M3 independent postrepair refuses ' + label, () => {
    const child = check(note)
    assert.equal(child.status, 1,
      'direct identifier bypass:\n' + note + '\n' + child.stdout + '\n' + child.stderr)
    assert.match(child.stdout + child.stderr, /obvious participant identifier/)
  })
}

test('M3 independent postrepair preserves safe pseudonyms and ordinary table facts', () => {
  for (const note of [
    '| __participantKey__ | pseudonym-only |',
    '> | `studyId` | synthetic-week |',
    '> > | __Product name__ | Courgette |',
    '| `Store name` | DekaMarkt |',
    '> | `Field` | Description of the policy |',
    '| __account information policy__ | no direct identifiers permitted |',
  ]) {
    const child = check(note)
    assert.equal(child.status, 0,
      'unexpected false positive:\n' + note + '\n' + child.stdout + '\n' + child.stderr)
  }
})
