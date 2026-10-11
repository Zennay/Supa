import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent postrepair QA #1528 checks, fictional data, no source mutation.
// Nested formatting has at most 3 layers; this is not universal PII parsing.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))
function scan(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-markdown-postrepair-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'nested'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Fictional test data only\\n')
    const file = join(root, 'evidence', 'm3', 'nested', 'fixture.md')
    writeFileSync(file, markdown)
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null, 'scanner process must finish')
    assert.equal(readFileSync(file, 'utf8'), markdown, 'original Markdown bytes are immutable')
    return { code: result.status, output: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
const rejected = [
  "- participant_**`*name*`**: fabricated-person",
  "- account_`***id***`: imaginary-identifier",
  "- full_***`name`***: toy-person",
  "- participant_****email****: fictional-contact",
  "| participant_***`name`*** | synthetic-student |"
]
for (const [i, fixture] of rejected.entries()) {
  test('QA #1528 postrepair nested disclosed ID ' + (i + 1), () => {
    const result = scan(fixture)
    assert.equal(result.code, 1, 'missed disclosure: ' + JSON.stringify(fixture) + '\\n' + result.output)
    assert.match(result.output, /obvious participant identifier/)
  })
}
const accepted = [
  "- ingredient_**`*name*`**: broccoli",
  "- item_`***id***`: product-123",
  "- full_***`name`*** is an identifier that must not be collected.",
  "- participant_****email**** is only prohibited-policy prose.",
  "| shop_***`name`*** | PLUS |"
]
for (const [i, fixture] of accepted.entries()) {
  test('QA #1528 postrepair nested benign controls ' + (i + 1), () => {
    const result = scan(fixture)
    assert.equal(result.code, 0, 'false positive: ' + JSON.stringify(fixture) + '\\n' + result.output)
  })
}
