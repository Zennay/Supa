import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scannerPath = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-encoded-assign-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence/m3'), { recursive: true })
    copyFileSync(scannerPath, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence/m3/README.md'), '# Synthetic only\n')
    writeFileSync(join(root, 'evidence/m3/note.md'), note + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null)
    return result
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// In rendered Markdown/HTML, numeric and named entities are ordinary colon
// or equals signs. These values and file trees are fabricated for QA only.
for (const [label, note] of [
  ['numeric decimal colon', 'participant_name&#58; synthetic-value'],
  ['numeric decimal equals in task item', '- [ ] account-id&#61; synthetic-value'],
  ['numeric hex colon in quote', '> "participant_email"&#x3A; synthetic-value'],
  ['numeric hex equals in ordered item', '2. e-mail-adres&#x3d; synthetic-value'],
  ['named colon entity', 'full.name&colon; synthetic-value'],
  ['named equals entity', 'account-id&equals; synthetic-value'],
]) {
  test('QA M3 expected RED encoded direct-ID assignment: ' + label, () => {
    const result = scan(note)
    assert.equal(result.status, 1, 'encoded assignment bypassed scanner:\n' + note + '\n' + result.stdout + result.stderr)
    assert.match(result.stdout + result.stderr, /obvious participant identifier/)
  })
}

test('QA M3 encoded assignment neutral controls stay accepted', () => {
  for (const note of [
    'Do not ever write participant_name&colon; a real value.',
    '- participantKey&#58; synthetic-pseudonym',
    '- store_name&equals; PLUS',
    '3. Ingredient details: broccoli',
    'Explain &#58; and &equals; as encoding examples with no private fields.',
  ]) {
    const result = scan(note)
    assert.equal(result.status, 0, 'safe control rejected:\n' + note + '\n' + result.stdout + result.stderr)
  }
})
