import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent #1528 postrepair acceptance on frozen #1678, add-only.
// All labels and values are fictional, with no observed basket evidence.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))
function runGuard(text) {
  const root = mkdtempSync(join(tmpdir(), 'supa-markdown-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'review'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic QA only\n')
    const notePath = join(root, 'evidence', 'm3', 'review', 'fictional.md')
    writeFileSync(notePath, text)
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null, 'real privacy scanner must finish')
    assert.equal(readFileSync(notePath, 'utf8'), text, 'durable notes must remain byte-identical')
    return { code: result.status, output: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// New vectors are independent of the diagnostic input list.
const rejected = [
  '- partici*pant*_name: fictional-person',
  '- account_`email`: imaginary-contact',
  '> **participant**_**email**: sample-identity',
  '| full **name** | fictitious-person |',
  '- e-*mail*-adres: invented-contact',
  '### account_**id** = toy-identifier',
  '<strong>parti*cipant*_name</strong>: fictional-person',
  '[parti**cipant**_name](https://example.invalid/help): toy-person',
  '- full `name`: imaginary-person',
]
for (const [i, note] of rejected.entries()) {
  test('QA #1528 independent Markdown split-label reject ' + (i + 1), () => {
    const r = runGuard(note)
    assert.equal(r.code, 1, 'identifier missed: ' + JSON.stringify(note) + '\n' + r.output)
    assert.match(r.output, /obvious participant identifier/)
  })
}

const accepted = [
  '- **Ingredient**: courgette',
  '- product_**name**: oats',
  '- member_**name**: tofu',
  'savings_cents: 200',
  '- participant_**email** is a prohibited field.',
  '- Account **ID** fields must never appear in collected notes.',
  '| Ingredient *Name* | Broccoli |',
  'No real email addresses or receipt photos are present.',
  '- source_`type`: manual-operator',
]
for (const [i, note] of accepted.entries()) {
  test('QA #1528 independent Markdown split-label benign ' + (i + 1), () => {
    const r = runGuard(note)
    assert.equal(r.code, 0, 'benign text was rejected: ' + JSON.stringify(note) + '\n' + r.output)
  })
}
