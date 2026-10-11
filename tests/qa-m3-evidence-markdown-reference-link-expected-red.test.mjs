import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent synthetic expected-RED probe after green #1660; no real PII.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function run(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-ref-link-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'week-003'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic M3 review policy\n')
    const path = join(root, 'evidence', 'm3', 'week-003', 'synthetic.md')
    writeFileSync(path, note)
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null)
    assert.equal(readFileSync(path, 'utf8'), note, 'source note must remain unchanged')
    return { status: result.status, log: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const markedDirectIds = [
  '- [participant_name][person]: example-subject\n\n[person]: https://example.invalid/details',
  '> **[Full Name][who]** = invented-person\n\n[who]: https://example.invalid/details',
  '| [account-id][id] | synthetic-id |\n\n[id]: https://example.invalid/details',
  '- [participant.email][] = test-label\n\n[participant.email]: https://example.invalid/details',
]

for (const [index, note] of markedDirectIds.entries()) {
  test('QA #1528: reference-style visible direct-ID field rejects saved note (' + (index + 1) + ')', () => {
    const result = run(note)
    assert.equal(result.status, 1, 'reference link hides direct ID: ' + JSON.stringify(note) + '\n' + result.log)
    assert.match(result.log, /obvious participant identifier/)
  })
}

test('QA #1528: linked policy, ingredient, store and pseudonym references are still permitted', () => {
  for (const note of [
    '- [participantKey][anon]: synthetic-reference\n\n[anon]: #pseudonym',
    '- [Ingredient name][ingredient]: courgette\n\n[ingredient]: #item',
    '| [Store name][store] | PLUS |\n\n[store]: #shop',
    'Do not include [participant_name][privacy] information.\n\n[privacy]: #policy',
    '- [studyId][]: fake-week\n\n[studyId]: #metadata',
  ]) {
    const result = run(note)
    assert.equal(result.status, 0, 'reference link rejected safe text: ' + JSON.stringify(note) + '\n' + result.log)
  }
})
