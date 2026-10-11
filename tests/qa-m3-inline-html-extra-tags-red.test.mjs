import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent #1528 expected-RED repro on frozen privacy scanner.
// Only fictional values; tests execute the real scanner in a disposable M3 tree.
// This is a bounded Markdown/HTML privacy backstop, not full HTML/PII parsing.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scannerPath = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-extra-inline-html-red-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'review'), { recursive: true })
    copyFileSync(scannerPath, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic privacy boundary\n')
    const sample = join(root, 'evidence', 'm3', 'review', 'sample.md')
    writeFileSync(sample, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null, 'scanner must complete')
    assert.equal(readFileSync(sample, 'utf8'), note, 'inspection must preserve evidence bytes')
    return { status: child.status, output: child.stdout + child.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, note] of [
  ['marked up participant field', '- participant<mark>_name</mark>: fictional-student'],
  ['underlined full-name field', '> full<u> name</u> = fictional-person'],
  ['small HTML account field', '<small>account</small>_id: fictional-account'],
]) {
  test('QA #1528 expected RED: visibly continuous ' + label, () => {
    const result = scan(note)
    assert.equal(result.status, 1, 'rendered direct-ID label evaded scanner: ' + JSON.stringify(note) + '\n' + result.output)
    assert.match(result.output, /obvious participant identifier/)
  })
}

test('QA #1528 extra inline HTML controls do not flag grocery or policy notes', () => {
  for (const note of [
    '- ingredient<mark>_name</mark>: Broccoli',
    '> store<u> name</u> = PLUS',
    '<small>study</small>Id: synthetic-week',
    'Policy: participant<mark>_name</mark> is prohibited, without any field value.',
    '<mark>Contact policy</mark>: never collect private names or account identifiers.',
  ]) {
    const result = scan(note)
    assert.equal(result.status, 0, 'benign M3 note rejected: ' + JSON.stringify(note) + '\n' + result.output)
  }
})
