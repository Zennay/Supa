import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent postrepair acceptance: different invented layouts and aliases
// from the expected-RED probe. Only disposable M3 evidence, never live data.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function scanDisposableMarkdown(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-invisible-aliases-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'safe', 'nested'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Fictional privacy review\n')
    const target = join(root, 'evidence', 'm3', 'safe', 'nested', 'record.md')
    writeFileSync(target, markdown, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const out = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(out.error)
    assert.notEqual(out.status, null, 'privacy scan process returned no status')
    assert.equal(readFileSync(target, 'utf8'), markdown, 'original durable Markdown must stay identical')
    return { status: out.status, output: out.stdout + out.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, markdown] of [
  ['inline HTML table af alias', '<th>full&af;name</th><td>dummy-one</td>'],
  ['it alias plain account email', 'account&it;email = imagined-two'],
  ['ic alias Dutch identity strong', '- **naam&ic;deelnemer**: fabricated-three'],
  ['multiple HTML5 aliases', 'participant&af;&ic;email: invented-four'],
  ['raw U+2064 quoted name', '> "full\u2064name": example-five'],
  ['hex numeric U+2064 in definition list', '<dt>account&#x2064;id</dt><dd>dummy-six</dd>'],
  ['decimal numeric U+2064 in table', '| participant&#8292;name | test-seven |'],
  ['raw U+2064 account ID strong', '**account\u2064id** = made-up-eight'],
  ['named alias in numbered list', '5. participant&it;name: sample-nine'],
]) {
  test('QA #1737 independently rejects ' + label, () => {
    const out = scanDisposableMarkdown(markdown)
    assert.equal(out.status, 1, 'missed clear fictional direct identity label: ' + markdown + '\n' + out.output)
    assert.match(out.output, /obvious participant identifier/)
  })
}

test('QA #1737 independent controls allow legitimate catalog and privacy-policy Markdown', () => {
  for (const markdown of [
    'item&af;name: basil',
    '<th>recipe&it;id</th><td>vegetable-bowl</td>',
    '- **ingredient&ic;name**: pasta',
    'product&af;&ic;category: greens',
    '> "store\u2064code": Example',
    '<dt>planning&#x2064;week</dt><dd>1</dd>',
    '| basket&#8292;source | local |',
    'participantKey: student-pseudonym-004',
    'Policy: participant names and account emails must never be committed.',
  ]) {
    const out = scanDisposableMarkdown(markdown)
    assert.equal(out.status, 0, 'safe contextual Markdown rejected: ' + markdown + '\n' + out.output)
  }
})
