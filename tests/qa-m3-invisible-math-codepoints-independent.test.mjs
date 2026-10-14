import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Synthetic QA only: complete evidence/README isolation and immutable source.
// The archived #1736 suite covers HTML5 named invisible math entities. This
// independent suite covers literal and numeric versions of the same glyphs.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function inspectDisposableMarkdown(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-math-codepoints-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'qa'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic evidence only\n')
    const path = join(root, 'evidence', 'm3', 'qa', 'note.md')
    writeFileSync(path, markdown, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null, 'test scanner was interrupted')
    assert.equal(readFileSync(path, 'utf8'), markdown, 'never rewrite evidence bytes')
    return { status: result.status, output: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [name, markdown] of [
  ['raw ApplyFunction', 'participant\u2061email: invented-alpha'],
  ['raw InvisibleTimes', '**full\u2062name**: invented-beta'],
  ['numeric hexadecimal InvisibleComma', '| account&#x2063;id | invented-gamma |'],
  ['numeric decimal InvisibleTimes', 'naam&#8290;deelnemer: invented-delta'],
]) {
  test('M3 Markdown privacy rejects ' + name + ' inside direct identity labels', () => {
    const outcome = inspectDisposableMarkdown(markdown)
    assert.equal(outcome.status, 1, markdown + '\n' + outcome.output)
    assert.match(outcome.output, /obvious participant identifier/)
  })
}

for (const markdown of [
  'product\u2061name: broccoli',
  '| store&#x2063;id | fake-store |',
  'Policy: do not commit participant names, email addresses or receipts.',
  'participantKey: pseudonymous-test-001',
]) {
  test('M3 Markdown privacy preserves benign visible grocery text: ' + markdown.slice(0, 24), () => {
    const outcome = inspectDisposableMarkdown(markdown)
    assert.equal(outcome.status, 0, markdown + '\n' + outcome.output)
  })
}
