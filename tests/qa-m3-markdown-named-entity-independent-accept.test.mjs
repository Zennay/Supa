import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const scanner = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const original = fileURLToPath(new URL('./' + scanner, import.meta.url))
function run(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-named-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence/m3'), { recursive: true })
    copyFileSync(original, join(root, 'tests', scanner))
    writeFileSync(join(root, 'evidence/m3/README.md'), '# Synthetic fixture\n')
    writeFileSync(join(root, 'evidence/m3/fabricated.md'), note + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', scanner)], {
      cwd: root, env, encoding: 'utf8', timeout: 20000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    return child
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [name, note] of [
  ['named label and named colon in checkbox', '- [ ] participant&lowbar;name&colon; synthetic-value'],
  ['named dot and numeric equals in quotation', '> 2. "full&period;name"&#61; synthetic-value'],
  ['named lowbar inside table inline code', '| `account&lowbar;id` | synthetic-value |'],
  ['named Unicode hyphen inside marked HTML cell', '<td><strong>e&hyphen;mail&hyphen;adres</strong></td><td>synthetic-value</td>'],
  ['named label and assignment in HTML comment', '<!-- participant&lowbar;email&equals; synthetic-value -->'],
]) {
  test('QA M3 independent named-entity privacy acceptance: ' + name, () => {
    const result = run(note)
    assert.equal(result.status, 1, 'synthetic rendered direct-ID bypassed scanner:\n' + note + '\n' + result.stdout + result.stderr)
    assert.match(result.stdout + result.stderr, /obvious participant identifier/)
  })
}

test('QA M3 named-entity independent benign controls', () => {
  for (const note of [
    'The forbidden participant&lowbar;name label is documented without a field value.',
    'participantKey: synthetic-pseudonym',
    '| ingredient&period;id | broccoli |',
    '- store&hyphen;name: DekaMarkt',
    'Remember to escape &lowbar; and &period; in Markdown examples.',
  ]) {
    const result = run(note)
    assert.equal(result.status, 0, 'benign metadata falsely rejected:\n' + note + '\n' + result.stdout + result.stderr)
  }
})
