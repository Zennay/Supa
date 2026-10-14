import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent postrepair acceptance for QA #723, not a duplicate of the RED
// fixtures. Raw filenames are staged only in a disposable alternate index.
const root = fileURLToPath(new URL('../', import.meta.url))
const guard = fileURLToPath(new URL('./repository-hygiene-contract.test.mjs', import.meta.url))
const harmlessObject = execFileSync('git', ['rev-parse', 'HEAD:.gitignore'], {
  cwd: root, encoding: 'utf8',
}).trim()

function guardResult(paths) {
  const scratch = mkdtempSync(join(tmpdir(), 'supa-qa-723-prefix-accept-'))
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') }
    const seed = spawnSync('git', ['read-tree', 'HEAD'], { cwd: root, env })
    assert.equal(seed.status, 0, seed.stderr?.toString())
    const records = Buffer.concat(paths.map((path) => Buffer.concat([
      Buffer.from('100644 ' + harmlessObject + ' 0\t'),
      Buffer.from(path, 'utf8'),
      Buffer.from([0]),
    ])))
    const add = spawnSync('git', ['update-index', '-z', '--index-info'], {
      cwd: root, env, input: records,
    })
    assert.equal(add.status, 0, 'could not construct synthetic Git index: ' + add.stderr?.toString())
    const bytes = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root, env })
    for (const path of paths) {
      assert.ok(bytes.includes(Buffer.concat([Buffer.from('\t'), Buffer.from(path), Buffer.from([0])])), path)
    }
    const childEnv = { ...env }
    delete childEnv.NODE_TEST_CONTEXT
    const processResult = spawnSync(process.execPath, ['--test', guard], {
      cwd: root, env: childEnv, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
    })
    assert.ifError(processResult.error)
    assert.notEqual(processResult.status, null)
    return { pass: processResult.status === 0, logs: (processResult.stdout || '') + (processResult.stderr || '') }
  } finally {
    rmSync(scratch, { force: true, recursive: true })
  }
}

for (const [label, files] of [
  ['nested case-folding', ['__supa_accept__/src/Feature', '__supa_accept__/src/feature/components/View.ts']],
  ['Kelvin-sign equivalent', ['__supa_accept__/Key', '__supa_accept__/key/note.md']],
  ['compatibility ligature', ['__supa_accept__/oﬃce', '__supa_accept__/office/note.md']],
  ['accent canonicalization', ['__supa_accept__/café', '__supa_accept__/cafe\u0301/deep/note.md']],
]) {
  test('QA #723 independent: reject portable file/directory collision (' + label + ')', () => {
    const result = guardResult(files)
    assert.equal(result.pass, false, 'nonportable staged records accepted: ' + label + '\n' + result.logs)
    assert.match(result.logs, /portable path collision/)
  })
}

for (const [label, files] of [
  ['casefolded folder with nonidentical leaves',
    ['__supa_accept__/Docs/intro.md', '__supa_accept__/docs/usage.md']],
  ['distinct sibling names',
    ['__supa_accept__/Config.md', '__supa_accept__/config/README.md']],
  ['Unicode nested folders with distinct files',
    ['__supa_accept__/Café/a.md', '__supa_accept__/cafe\u0301/b.md']],
]) {
  test('QA #723 independent: retain safe portability control (' + label + ')', () => {
    const result = guardResult(files)
    assert.equal(result.pass, true, 'legitimate staged records rejected: ' + label + '\n' + result.logs)
  })
}
