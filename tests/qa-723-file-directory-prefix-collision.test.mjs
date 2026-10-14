import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// #723: independent, review-only Windows/macOS portability regression.
// Synthetic filenames live only in a disposable alternate Git index.
// Neither ignored files nor real private/retailer evidence are read.
const cwd = fileURLToPath(new URL('../', import.meta.url))
const guard = fileURLToPath(new URL('./repository-hygiene-contract.test.mjs', import.meta.url))
const objectId = execFileSync('git', ['rev-parse', 'HEAD:.gitignore'], { cwd, encoding: 'utf8' }).trim()

function runAgainstTemporaryIndex(paths) {
  const scratch = mkdtempSync(join(tmpdir(), 'supa-qa-723-prefix-'))
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') }
    const seed = spawnSync('git', ['read-tree', 'HEAD'], { cwd, env })
    assert.equal(seed.status, 0, seed.stderr?.toString())

    const records = paths.map((path) => Buffer.concat([
      Buffer.from('100644 ' + objectId + ' 0\t'),
      Buffer.from(path, 'utf8'),
      Buffer.from([0]),
    ]))
    const staged = spawnSync('git', ['update-index', '-z', '--index-info'], {
      cwd, env, input: Buffer.concat(records),
    })
    assert.equal(staged.status, 0, 'synthetic index staging failed: ' + staged.stderr?.toString())

    const indexBytes = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd, env })
    for (const path of paths) {
      const record = Buffer.concat([Buffer.from('\t'), Buffer.from(path, 'utf8'), Buffer.from([0])])
      assert.ok(indexBytes.includes(record), 'test must pin staged raw filename: ' + path)
    }

    const childEnv = { ...env }
    delete childEnv.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', guard], {
      cwd, env: childEnv, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null)
    return { status: result.status, output: (result.stdout || '') + (result.stderr || '') }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const rejected = [
  ['case-folded file versus folder',
    ['__supa_portable_prefix__/Report', '__supa_portable_prefix__/report/notes.md']],
  ['Unicode sharp-s case-folded file versus folder',
    ['__supa_portable_prefix__/straße', '__supa_portable_prefix__/strasse/notes.md']],
  ['NFKC-compatible fullwidth file versus folder',
    ['__supa_portable_prefix__/Ｒｅｐｏｒｔ', '__supa_portable_prefix__/Report/notes.md']],
]

for (const [label, paths] of rejected) {
  test('QA #723: reject ' + label + ' in a real synthetic Git index', () => {
    const result = runAgainstTemporaryIndex(paths)
    assert.notEqual(result.status, 0, 'ambiguous file/directory pair was accepted: ' + label + '\n' + result.output)
    assert.match(result.output, /portable path collision/,
      'the failure must be specifically the portable path collision guard')
  })
}

test('QA #723: case-insensitive same directory containing distinct files remains valid', () => {
  const result = runAgainstTemporaryIndex([
    '__supa_portable_prefix__/Images/a.md',
    '__supa_portable_prefix__/images/b.md',
  ])
  assert.equal(result.status, 0, 'legitimate same-directory coexistence rejected:\n' + result.output)
})

test('QA #723: similar file name is not itself a directory-prefix collision', () => {
  const result = runAgainstTemporaryIndex([
    '__supa_portable_prefix__/Report.txt',
    '__supa_portable_prefix__/report/notes.md',
  ])
  assert.equal(result.status, 0, 'unrelated file and directory rejected:\n' + result.output)
})
