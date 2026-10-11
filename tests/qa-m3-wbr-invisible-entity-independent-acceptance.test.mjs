import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent postrepair QA #1528: only fictional field labels / contacts.
// The real repository M3 scanner is copied into a disposable evidence tree.
// No source Markdown is rewritten and no actual field record is inspected.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))
function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-wbr-format-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'review', 'nested'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic-only M3 evidence\n')
    const path = join(root, 'evidence', 'm3', 'review', 'nested', 'note.md')
    writeFileSync(path, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    assert.equal(readFileSync(path, 'utf8'), note, 'evidence source must stay byte-identical')
    return { status: child.status, output: child.stdout + child.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, note] of [
  ['uppercase self-closing break', '- PARTICIPANT<WBR />_NAME: fictional-student'],
  ['attributed wordbreak in Markdown table', '| account<wbr data-hint="word">_email | synthetic-identifier |'],
  ['email with two wordbreaks', 'Contact: fictional@exa<wbr>mple.<wbr>test'],
  ['decimal invisible U+2060', '> full&#8288; name = invented-person'],
  ['hex invisible U+2067', '- account&#x2067;_id: madeup-ref'],
  ['numeric soft hyphen in mailto target', '[private](mailto:fiction&#173;al@example.test)'],
  ['numeric U+200C inside quoted field', '"participant&#8204;_name": "example-student"'],
]) {
  test('QA #1528 independent privacy acceptance refuses invisible rendering: ' + label, () => {
    const result = scan(note)
    assert.equal(result.status, 1, 'missed synthetic identifier ' + JSON.stringify(note) + '\n' + result.output)
    assert.match(result.output, /obvious participant identifier/)
  })
}

test('QA #1528 independent acceptance keeps harmless visible metadata and prose', () => {
  for (const note of [
    '- store<WBR />_name: DekaMarkt',
    'Ingredient: pasta<wbr>salade',
    'Recipe steps: press <kbd>Enter</kbd> to continue.',
    'Never record account&#x200B;_id in research evidence.',
    'A non-ASCII numeric reference: &#169;.',
    'A malformed numeric reference: &#xXYZ;.',
    'Study metadata participantKey: fictional-key-001',
    '| ingredient&#8203;_name | Courgette |',
  ]) {
    const result = scan(note)
    assert.equal(result.status, 0, 'benign case incorrectly rejected '+JSON.stringify(note)+'\n'+result.output)
  }
})
