import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent postrepair acceptance for NFKC artifact-path policy.
// Uses disposable Git index records backed by the public .gitignore object.
// No tracked file values, secrets or participant evidence are opened.
const root = fileURLToPath(new URL('../', import.meta.url))
const guard = fileURLToPath(new URL('./repository-hygiene-contract.test.mjs', import.meta.url))
const harmlessBlob = execFileSync('git', ['rev-parse', 'HEAD:.gitignore'], {
  cwd: root, encoding: 'utf8',
}).trim()

function testIndex(paths) {
  const scratch = mkdtempSync(join(tmpdir(), 'supa-qa-723-alias-accept-'))
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') }
    const seed = spawnSync('git', ['read-tree', 'HEAD'], { cwd: root, env })
    assert.equal(seed.status, 0, seed.stderr?.toString())
    const bytes = Buffer.concat(paths.map((path) => Buffer.concat([
      Buffer.from('100644 ' + harmlessBlob + ' 0\t'),
      Buffer.from(path, 'utf8'),
      Buffer.from([0]),
    ])))
    const update = spawnSync('git', ['update-index', '-z', '--index-info'], {
      cwd: root, env, input: bytes,
    })
    assert.equal(update.status, 0, update.stderr?.toString())
    const staged = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root, env })
    for (const p of paths) assert.ok(
      staged.includes(Buffer.concat([Buffer.from('\t' + p, 'utf8'), Buffer.from([0])])),
      'missing synthetic stage entry: ' + p,
    )
    const childEnv = { ...env }
    delete childEnv.NODE_TEST_CONTEXT
    const run = spawnSync(process.execPath, ['--test', guard], {
      cwd: root, env: childEnv, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
    })
    assert.ifError(run.error)
    assert.notEqual(run.status, null)
    return { ok: run.status === 0, output: (run.stdout || '') + (run.stderr || '') }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

for (const [label, path] of [
  ['root generated Vite javascript config', 'ｖｉｔｅ．ｃｏｎｆｉｇ．ｊｓ'],
  ['root generated Vite declaration config', 'ｖｉｔｅ．ｃｏｎｆｉｇ．ｄ．ｔｓ'],
  ['fullwidth example is not the canonical .env.example exception', '__supa_accept__/src/．ｅｎｖ.example'],
  ['mixed compatibility local artifacts directory', '__supa_accept__/ａｒｔｉｆａｃｔｓ/fixture.json'],
  ['fullwidth IDE directory', '__supa_accept__/src/．ＩＤＥＡ/setting.xml'],
  ['fullwidth tsbuildinfo suffix', '__supa_accept__/src/tsconfig．ｔｓｂｕｉｌｄｉｎｆｏ'],
  ['fullwidth macOS finder file', '__supa_accept__/src/．ＤＳ_ＳＴＯＲＥ'],
]) {
  test('QA #723 independent: forbid compatibility alias ' + label, () => {
    const result = testIndex([path])
    assert.equal(result.ok, false, 'alias bypass: ' + path + '\n' + result.output)
    assert.match(result.output, /forbidden tracked artifact/)
  })
}

test('QA #723 independent: allow benign compatibility metadata and exact .env example', () => {
  for (const path of [
    '__supa_accept__/src/ｃｏｎｆｉｇ.md',
    '__supa_accept__/src/ａｒｔｉｆａｃｔｓ-notes/README.md',
    '__supa_accept__/docs/ｅｎｖ.note',
    '__supa_accept__/src/ｍｅａｌｓ/recipe.md',
    '__supa_accept__/src/Café/receipt-template.md',
    '.env.example',
  ]) {
    const result = testIndex([path])
    assert.equal(result.ok, true, 'safe path incorrectly rejected: ' + path + '\n' + result.output)
  }
})
