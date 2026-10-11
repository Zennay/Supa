import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent postrepair review on frozen #1701.
// All names, emails and account references are fictional. The actual M3
// repository privacy guard scans a nested, disposable evidence directory.
// This is not a general HTML parser, PII detector or M3 field observation.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))
function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-extra-html-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'nested'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Fictional evidence policy\n')
    const file = join(root, 'evidence', 'm3', 'nested', 'note.md')
    writeFileSync(file, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    assert.equal(readFileSync(file, 'utf8'), note, 'scanning must not rewrite actual note bytes')
    return { code: child.status, log: child.stdout + child.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, note] of [
  ['nested visible label', '- participant<mark><u>_name</u></mark>: fake-person'],
  ['uppercase inline tag', '> FULL<MARK> NAME</MARK> = invented-user'],
  ['tag with benign attribute', '3. account<mark class="qa-highlight">-id</mark>: synthetic-account'],
  ['fragmented account name', 'account<small>_email</small> = synthetic-internal-reference'],
  ['table cell label', '| participant<u>_name</u> | synthetic-student |'],
  ['visible email split by small element', 'Contact: fake@exam<small>ple</small>.test'],
]) {
  test('QA #1528 independently rejects additional HTML phrasing disclosure: ' + label, () => {
    const r = scan(note)
    assert.equal(r.code, 1, 'missed fictional identifier ' + JSON.stringify(note) + '\n' + r.log)
    assert.match(r.log, /obvious participant identifier/)
  })
}

test('QA #1528 acceptance: safe Markdown, shopping and policy controls are permitted', () => {
  for (const note of [
    'Store <mark>name</mark>: DekaMarkt',
    '- ingredient<u>_name</u>: Griekse yoghurt',
    '<small>study</small>Id: example-week',
    'participant<mark>_name</mark> is a forbidden key: do not put it in evidence.',
    '| store<small>_name</small> | PLUS |',
    'Policy: [privacy](#rules) forbids participant emails and account IDs.',
  ]) {
    const r = scan(note)
    assert.equal(r.code, 0, 'false positive for allowed metadata ' + JSON.stringify(note) + '\n' + r.log)
  }
})
