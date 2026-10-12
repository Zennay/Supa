import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Synthetic Git index metadata only. No local user data, secrets, evidence
// captures or indexed blob content are opened.
const root = fileURLToPath(new URL('../', import.meta.url))
const guard = fileURLToPath(new URL('./repository-hygiene-contract.test.mjs', import.meta.url))
const safeBlob = execFileSync('git', ['rev-parse', 'HEAD:.gitignore'], {
  cwd: root, encoding: 'utf8',
}).trim()

function runGuard(paths) {
  const scratch = mkdtempSync(join(tmpdir(), 'supa-bidi-path-red-'))
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') }
    const readTree = spawnSync('git', ['read-tree', 'HEAD'], { cwd: root, env })
    assert.equal(readTree.status, 0, readTree.stderr?.toString())
    const data = Buffer.concat(paths.map((path) => Buffer.concat([
      Buffer.from('100644 ' + safeBlob + ' 0\t'),
      Buffer.from(path, 'utf8'),
      Buffer.from([0]),
    ])))
    const update = spawnSync('git', ['update-index', '-z', '--index-info'], {
      cwd: root, env, input: data,
    })
    assert.equal(update.status, 0, update.stderr?.toString())
    const tracked = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root, env })
    for (const path of paths) {
      assert.ok(tracked.includes(Buffer.concat([
        Buffer.from('\t' + path), Buffer.from([0]),
      ])), 'synthetic entry absent')
    }
    const childEnv = { ...env }
    delete childEnv.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', guard], {
      cwd: root, env: childEnv, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null)
    return { status: result.status, output: (result.stdout || '') + (result.stderr || '') }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

for (const [name, path] of [
  ['right-to-left override', 'docs/notes\u202etxt.md'],
  ['left-to-right override', 'docs/report\u202dpart.md'],
  ['left-to-right isolate', 'src/note\u2066a.ts'],
  ['right-to-left isolate', 'src/note\u2067b.ts'],
  ['left-to-right mark', 'docs/note\u200emark.md'],
  ['Arabic letter mark', 'docs/note\u061cmark.md'],
]) {
  test('QA #1794: reject Git path with ' + name, () => {
    const result = runGuard([path])
    assert.notEqual(result.status, 0, 'unsafe bidi path accepted\n' + result.output)
    assert.match(result.output, /tracked checkout violates reviewed hygiene contract/)
  })
}

test('QA #1794: preserve ordinary readable multilingual and combining filenames', () => {
  const result = runGuard([
    'docs/maaltijdplanning.md',
    'docs/مرحبا.md',
    'docs/שלום.md',
    'docs/cafe\u0301.md',
    'docs/🥦-recepten.md',
  ])
  assert.equal(result.status, 0, 'ordinary text incorrectly rejected\n' + result.output)
})
