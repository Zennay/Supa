import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent acceptance of bounded mailto percent-decoding after DRAFT #1698.
// Disposable fictional files only. No source or genuine M3 evidence edits.
const scanner = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const canonical = fileURLToPath(new URL('./' + scanner, import.meta.url))
function scan(noteText) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-mailto-postrepair-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'sample'), { recursive: true })
    copyFileSync(canonical, join(root, 'tests', scanner))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Fake study\n')
    const path = join(root, 'evidence', 'm3', 'sample', 'note.md')
    writeFileSync(path, noteText)
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', scanner)],
      { env, cwd: root, encoding: 'utf8', timeout: 20_000 })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    assert.equal(readFileSync(path, 'utf8'), noteText, 'original fixture bytes must stay unchanged')
    return { status: child.status, text: child.stdout + child.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, note] of [
  ['encoded uppercase AT', '[review](mailto:fake.person%40example.test)'],
  ['encoded lowercase dot', '> [review](mailto:fake.person%40example%2etest)'],
  ['encoded ASCII host character', '<a href="mailto:fake%40exam%70le.test">Write</a>'],
  ['encoded ASCII local characters', 'Contact: mailto:%66ake%2Eperson%40example.test'],
  ['HTML numeric percent display and encoded recipient', '[Send](mailto:fake%40example&#46;test)'],
]) {
  test('QA #1528 independent encoded mailto recipient rejected: ' + label, () => {
    const child = scan(note + '\n')
    assert.equal(child.status, 1, 'synthetic recipient missed:\n' + note + '\n' + child.text)
    assert.match(child.text, /obvious participant identifier/)
  })
}

for (const [label, note] of [
  ['normal URL percent encoded', '[Catalog](https://example.invalid/products%40sample.test)'],
  ['non address mailto token', 'mailto:fake%40example'],
  ['mailto incomplete TLD', '<a href="mailto:fake%40example.t">Contact</a>'],
  ['percent literal in price note', 'Percent encoding %2e means a dot in a URL.'],
  ['grocery-only identifier', 'Store item id: product%40sku'],
  ['pseudonymous reference', 'participantKey: synthetic-m3-qa'],
]) {
  test('QA #1528 independent percent-decoding benign control: ' + label, () => {
    const child = scan(note + '\n')
    assert.equal(child.status, 0, 'unexpected false positive:\n' + note + '\n' + child.text)
  })
}
