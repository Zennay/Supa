import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// QA #1801 expected RED. Only index metadata and public .gitignore blob ID.
// No private captures, credential values, contents or checkout changes.
const root = fileURLToPath(new URL('../', import.meta.url))
const guard = fileURLToPath(new URL('./repository-hygiene-contract.test.mjs', import.meta.url))
const blob = execFileSync('git', ['rev-parse', 'HEAD:.gitignore'], {
  cwd: root, encoding: 'utf8',
}).trim()

function acceptsSyntheticIndexPath(paths) {
  const dir = mkdtempSync(join(tmpdir(), 'supa-qa-1801-red-'))
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') }
    const seed = spawnSync('git', ['read-tree', 'HEAD'], { cwd: root, env })
    assert.equal(seed.status, 0, seed.stderr?.toString())
    for (const path of paths) {
      const record = Buffer.concat([
        Buffer.from('100644 ' + blob + ' 0\t'),
        Buffer.from(path, 'utf8'),
        Buffer.from([0]),
      ])
      const staged = spawnSync('git', ['update-index', '-z', '--index-info'], {
        cwd: root, env, input: record,
      })
      assert.equal(staged.status, 0, staged.stderr?.toString())
      const index = execFileSync('git', ['ls-files', '-z'], { cwd: root, env })
      assert.ok(index.includes(Buffer.concat([Buffer.from(path), Buffer.from([0])])))
    }
    const childEnv = { ...env }
    delete childEnv.NODE_TEST_CONTEXT
    const run = spawnSync(process.execPath, ['--test', guard], {
      cwd: root, env: childEnv, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
    })
    assert.ifError(run.error)
    return { accepted: run.status === 0, transcript: (run.stdout || '') + (run.stderr || '') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

for (const [name, path] of [
  ['Unicode U+0085 NEXT LINE inside documentation filename', 'docs/maandag\u0085dinsdag.md'],
  ['Unicode U+2028 LINE SEPARATOR inside report filename', 'docs/rapport\u2028totaal.md'],
  ['Unicode U+2029 PARAGRAPH SEPARATOR inside source filename', 'src/plan\u2029week.ts'],
  ['Unicode U+2028 used to visually split an environment-like path', 'docs/.env\u2028.example'],
  ['nested Unicode U+2029 segment under a normal folder', 'docs/collect\u2029results/notes.md'],
]) {
  test('QA #1801 expected RED: reject ' + name, () => {
    const result = acceptsSyntheticIndexPath([path])
    assert.equal(result.accepted, false,
      'tracked Unicode line-break path escaped checkout-only hygiene\n' + result.transcript)
    assert.match(result.transcript, /tracked checkout violates reviewed hygiene contract/)
  })
}

test('QA #1801: legitimate text, spacing, RTL and joiner controls remain permitted', () => {
  const result = acceptsSyntheticIndexPath([
    '.env.example',
    'docs/maandag\u00a0dinsdag.md',
    'docs/cafe\u0301.md',
    'docs/پیش\u200cغذا.md',
    'docs/👨‍👩‍👧‍👦-week.md',
    'src/planner/week.ts',
  ])
  assert.equal(result.accepted, true, 'safe Git paths must remain admissible\n' + result.transcript)
})
