import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const source = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const sourcePath = fileURLToPath(new URL('./' + source, import.meta.url))
function scan(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-assignment-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence/m3'), { recursive: true })
    copyFileSync(sourcePath, join(root, 'tests', source))
    writeFileSync(join(root, 'evidence/m3/README.md'), '# Synthetic QA only\n')
    writeFileSync(join(root, 'evidence/m3/fixture.md'), markdown + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', source)], {
      cwd: root, env, encoding: 'utf8', timeout: 20000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    return child
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, markdown] of [
  ['padded decimal colon', '1. participant_name&#000058; synthetic-value'],
  ['padded upper-hex equals', '- [x] account-id&#X00003D; synthetic-value'],
  ['named colon on indented quotation', '> 4. "full.name"&colon; synthetic-value'],
  ['named equals on marked field', '> **e-mail-adres**&equals; synthetic-value'],
  ['HTML comment with named delimiter', '<!-- participant_email&colon; synthetic-value -->'],
  ['mixed encoded field and delimiter', '| `participant&#95;name` | synthetic-value |'],
]) {
  test('QA M3 independent encoded assignment acceptance: ' + label, () => {
    const child = scan(markdown)
    assert.equal(child.status, 1, 'escaped rendered identifier:\n' + markdown + '\n' + child.stdout + child.stderr)
    assert.match(child.stdout + child.stderr, /obvious participant identifier/)
  })
}

test('QA M3 encoded assignment controls keep safe notes', () => {
  for (const markdown of [
    'Policy says participant_name&colon; is never a field to persist.',
    '- participantKey&equals; synthetic-pseudonym',
    'Store=PLUS; ingredient=broccoli',
    '| store_name | DekaMarkt |',
    'No direct identifiers: teach &#x3a; and &equals; as encoded symbols.',
  ]) {
    const child = scan(markdown)
    assert.equal(child.status, 0, 'benign note rejected:\n' + markdown + '\n' + child.stdout + child.stderr)
  }
})
