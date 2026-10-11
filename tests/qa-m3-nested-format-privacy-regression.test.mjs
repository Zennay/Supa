import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Isolated QA #1528 RED on frozen acceptance #1679. Fictional values only.
// The Markdown backstop is bounded and is not a complete PII detector.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-nested-privacy-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'review'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic QA only\n')
    const notePath = join(root, 'evidence', 'm3', 'review', 'fictional.md')
    writeFileSync(notePath, note)
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null, 'privacy guard must finish')
    assert.equal(readFileSync(notePath, 'utf8'), note, 'source bytes must remain untouched')
    return { code: result.status, output: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const rejected = [
  '- participant_***name***: fictional-person',
  '- participant_**`email`**: invented-identity',
  '> **full**_***name*** = pretend-person',
  '| account_***id*** | fictional-account |',
  '- participant_`**name**`: fabricated-person',
]

for (const [index, note] of rejected.entries()) {
  test('QA #1528 nested Markdown disclosure should fail closed ' + (index + 1), () => {
    const result = scan(note)
    assert.equal(result.code, 1, 'missed visible fictional ID: ' + JSON.stringify(note) + '\n' + result.output)
    assert.match(result.output, /obvious participant identifier/)
  })
}

const accepted = [
  '- ingredient_***name***: courgette',
  '- product_**`name`**: rice',
  '- participant_***name*** is a prohibited identifier field, never collect it.',
  '- participant_**`email`** is an example field name, without a value.',
  '| item_***id*** | fictional-produce |',
]

for (const [index, note] of accepted.entries()) {
  test('QA #1528 nested Markdown benign text remains allowed ' + (index + 1), () => {
    const result = scan(note)
    assert.equal(result.code, 0, 'false positive: ' + JSON.stringify(note) + '\n' + result.output)
  })
}
