import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Synthetic Git index metadata only; never read any path's file contents.
// These compatibility names fold under the same NFKC policy already used
// by the repository's cross-platform path-collision backstop.
const root = fileURLToPath(new URL('../', import.meta.url))
const scanner = fileURLToPath(new URL('./repository-hygiene-contract.test.mjs', import.meta.url))
const safeBlob = execFileSync('git', ['rev-parse', 'HEAD:.gitignore'], {
  cwd: root, encoding: 'utf8',
}).trim()

function checkStagedAliases(paths) {
  const scratch = mkdtempSync(join(tmpdir(), 'supa-qa-723-compat-'))
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') }
    const seed = spawnSync('git', ['read-tree', 'HEAD'], { cwd: root, env })
    assert.equal(seed.status, 0, seed.stderr?.toString())
    const entries = Buffer.concat(paths.map((path) => Buffer.concat([
      Buffer.from('100644 ' + safeBlob + ' 0\t'),
      Buffer.from(path, 'utf8'),
      Buffer.from([0]),
    ])))
    const stage = spawnSync('git', ['update-index', '-z', '--index-info'], {
      cwd: root, env, input: entries,
    })
    assert.equal(stage.status, 0, 'could not prepare alternate index: ' + stage.stderr?.toString())
    const indexed = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root, env })
    for (const path of paths) {
      assert.ok(indexed.includes(Buffer.concat([Buffer.from('\t' + path), Buffer.from([0])])), path)
    }
    const isolated = { ...env }
    delete isolated.NODE_TEST_CONTEXT
    const run = spawnSync(process.execPath, ['--test', scanner], {
      cwd: root, env: isolated, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
    })
    assert.ifError(run.error)
    assert.notEqual(run.status, null, 'hygiene guard never exited')
    return { accepted: run.status === 0, logs: (run.stdout || '') + (run.stderr || '') }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

for (const [label, path] of [
  ['compatibility artifacts folder', '__supa_qa__/ＡＲＴＩＦＡＣＴＳ/generated.json'],
  ['compatibility modules folder', '__supa_qa__/ＮＯＤＥ_ＭＯＤＵＬＥＳ/entry.js'],
  ['compatibility dist folder', '__supa_qa__/ｄｉｓｔ/index.html'],
  ['fullwidth env name', '__supa_qa__/src/．ｅｎｖ.local'],
  ['fullwidth IDE folder', '__supa_qa__/．ｖｓｃｏｄｅ/settings.json'],
  ['fullwidth log extension', '__supa_qa__/debug．ｌｏｇ'],
]) {
  test('QA #723 expected RED: forbid compatible local artifact ' + label, () => {
    const result = checkStagedAliases([path])
    assert.equal(result.accepted, false, 'portable forbidden alias accepted: ' + path + '\n' + result.logs)
    assert.match(result.logs, /forbidden tracked artifact/)
  })
}

test('QA #723 preserve distinct NFKC-normal metadata aliases and ordinary names', () => {
  for (const path of [
    '__supa_qa__/ＲＥＣＩＰＥＳ/demo.md',
    '__supa_qa__/src/Café/notes.md',
    '__supa_qa__/ｂａｓｋｅｔ/info.json',
    '__supa_qa__/receipt-template.example',
    '__supa_qa__/src/product-ｍｅｔａｄａｔａ.txt',
  ]) {
    const result = checkStagedAliases([path])
    assert.equal(result.accepted, true, 'legitimate repository metadata rejected: ' + path + '\n' + result.logs)
  }
})
