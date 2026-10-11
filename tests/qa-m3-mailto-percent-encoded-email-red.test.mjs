import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// M3 privacy synthetic expected-RED: mailto URIs can percent-encode the
// address characters. Only temporary notes; source M3 evidence is untouched.
const scannerFile = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scannerSource = fileURLToPath(new URL('./' + scannerFile, import.meta.url))
function run(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-mailto-percent-red-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'draft'), { recursive: true })
    copyFileSync(scannerSource, join(root, 'tests', scannerFile))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic review\n')
    const path = join(root, 'evidence', 'm3', 'draft', 'sample.md')
    writeFileSync(path, markdown)
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath,
      ['--test', join(root, 'tests', scannerFile)],
      { cwd: root, env, encoding: 'utf8', timeout: 20_000 })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    assert.equal(readFileSync(path, 'utf8'), markdown, 'preserve original fictional notes')
    return { code: child.status, output: child.stdout + child.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const unsafe = [
  ['percent encoded at-sign', '[contact](mailto:fictional.person%40example.test)'],
  ['percent encoded dot', '<a href="mailto:fictional%40example%2Etest">Contact</a>'],
  ['encoded ASCII letters', 'mailto:fictional%2Eperson%40ex%61mple.test'],
  ['URL-encoded user and host', '> [Write](mailto:%66ake%2Eperson%40example%2Etest)'],
]
for (const [name, note] of unsafe) {
  test('QA #1528 expected RED: ' + name, () => {
    const r = run(note + '\n')
    assert.equal(r.code, 1, 'encoded fictional email escaped M3 backstop: ' + note + '\n' + r.output)
    assert.match(r.output, /obvious participant identifier/)
  })
}

const safe = [
  ['regular URL percent-encoded handle', '[Catalog](https://example.invalid/product%40identifier)'],
  ['mailto without domain', '[General address](mailto:fictional%40example)'],
  ['mailto incomplete TLD', 'mailto:madeup%40example.c'],
  ['ordinary in-store information', 'Store URL encoding: %2Fproduct%2Dcode is not an email.'],
  ['pseudo participant reference', 'participantKey: synthetic-week-002'],
]
for (const [name, note] of safe) {
  test('QA #1528 benign percent-encoding control: ' + name, () => {
    const r = run(note + '\n')
    assert.equal(r.code, 0, 'safe metadata falsely flagged: ' + note + '\n' + r.output)
  })
}
