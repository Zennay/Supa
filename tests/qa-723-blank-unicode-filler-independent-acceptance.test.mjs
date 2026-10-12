import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent additional acceptance for QA #723 after narrowly scoped guard.
// Manipulates metadata in an alternate temporary Git index only: all staged
// paths point to the existing public .gitignore blob, never private file data.
const cwd = fileURLToPath(new URL('../', import.meta.url))
const guard = fileURLToPath(new URL('./repository-hygiene-contract.test.mjs', import.meta.url))
const blob = execFileSync('git', ['rev-parse', 'HEAD:.gitignore'], {
  cwd, encoding: 'utf8',
}).trim()

function guardPermits(paths) {
  const dir = mkdtempSync(join(tmpdir(), 'supa-qa-723-blank-accept-'))
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') }
    const seeded = spawnSync('git', ['read-tree', 'HEAD'], { cwd, env })
    assert.equal(seeded.status, 0, seeded.stderr?.toString())
    for (const p of paths) {
      const entry = Buffer.concat([
        Buffer.from('100644 ' + blob + ' 0\t'),
        Buffer.from(p, 'utf8'), Buffer.from([0]),
      ])
      const added = spawnSync('git', ['update-index', '-z', '--index-info'], {
        cwd, env, input: entry,
      })
      assert.equal(added.status, 0, added.stderr?.toString())
      const listed = execFileSync('git', ['ls-files', '-z'], { cwd, env })
      assert.ok(listed.includes(Buffer.concat([Buffer.from(p, 'utf8'), Buffer.from([0])])))
    }
    const childEnv = { ...env }
    delete childEnv.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', guard], {
      cwd, env: childEnv, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
    })
    assert.ifError(result.error)
    return { pass: result.status === 0, output: (result.stdout || '') + (result.stderr || '') }
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
}

for (const [caseName, path] of [
  ['Braille blank as entire directory segment', 'docs/\u2800/notes.md'],
  ['Braille blank preceding extension', 'docs/catalog\u2800.md'],
  ['two contiguous Hangul fillers', 'docs/report\u3164\uFFA0.txt'],
  ['Hangul choseong filler after ordinary Korean', 'docs/한국어\u115F.md'],
  ['Hangul jungseong filler at end of folder', 'docs/week\u1160/list.md'],
  ['halfwidth filler in environment-adjacent basename', 'src/.env\uFFA0.backup'],
  ['nested Hangul filler after a readable folder name', 'docs/collect/\u3164notes.md'],
]) {
  test('QA #723 independent rejects synthetic blank Unicode: ' + caseName, () => {
    const result = guardPermits([path])
    assert.equal(result.pass, false, 'blank glyph escaped guard:\n' + result.output)
    assert.match(result.output, /tracked checkout violates reviewed hygiene contract/)
  })
}

test('QA #723 independent keeps real Hangul, Braille, readable and joined Unicode paths', () => {
  const result = guardPermits([
    '.env.example',
    'docs/한글.md',
    'docs/한글한.md',
    'docs/⠠⠞⠑⠎⠞.md',
    'docs/⡏⡍⡅.md',
    'docs/café.md',
    'docs/cafe\u0301.md',
    'docs/پیش\u200cغذا.md',
    'docs/👩‍🍳-week.md',
    'src/features/shopping-list/README.md',
  ])
  assert.equal(result.pass, true, 'visible multilingual control overblocked:\n' + result.output)
})
