import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scannerPath = fileURLToPath(new URL('./' + scannerName, import.meta.url))
function runSyntheticMarkdown(note) {
  const dir = mkdtempSync(join(tmpdir(), 'supa-m3-entity-accept-'))
  try {
    mkdirSync(join(dir, 'tests'))
    mkdirSync(join(dir, 'evidence/m3'), { recursive: true })
    copyFileSync(scannerPath, join(dir, 'tests', scannerName))
    writeFileSync(join(dir, 'evidence/m3/README.md'), '# Synthetic QA only\n')
    writeFileSync(join(dir, 'evidence/m3/fixture.md'), note + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(dir, 'tests', scannerName)], {
      cwd: dir, env, encoding: 'utf8', timeout: 20000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null)
    return result
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

for (const [caseName, note] of [
  ['zero-padded decimal underscore', '1. participant&#000095;email: synthetic-value'],
  ['uppercase hex entity', '- [x] account&#X2D;email = synthetic-value'],
  ['zero-padded hexadecimal dot', '> "full&#x00002e;name": synthetic-value'],
  ['mixed escaped and numeric separators', '| `e\\-mail&#45;adres` | synthetic-value |'],
  ['HTML table wrappers with entity label', '<tr><th class="label">participant&#x5F;name</th><td>synthetic-value</td></tr>'],
]) {
  test('QA M3 independent numeric-entity acceptance: ' + caseName, () => {
    const output = runSyntheticMarkdown(note)
    assert.equal(output.status, 1, 'missed rendered direct-ID field:\n' + note + '\n' + output.stdout + output.stderr)
    assert.match(output.stdout + output.stderr, /obvious participant identifier/)
  })
}

test('QA M3 numeric-entity acceptance preserves neutral policy and groceries', () => {
  for (const note of [
    '2. Explain participant&#x5f;name is prohibited, without recording a value.',
    '> participantKey: synthetic-pseudonym',
    '| ingredient&#45;name | broccoli |',
    '<th>store&#46;name</th><td>DekaMarkt</td>',
    'Examples: &#x41; (letter A), &#x20; (space), &amp; (ampersand).',
  ]) {
    const output = runSyntheticMarkdown(note)
    assert.equal(output.status, 0, 'safe fixture falsely rejected:\n' + note + '\n' + output.stdout + output.stderr)
  }
})
