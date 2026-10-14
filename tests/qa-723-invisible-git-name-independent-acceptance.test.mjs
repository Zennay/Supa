import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent QA #723 acceptance: Git metadata with benign public blob IDs.
// No real secrets, evidence, private captures or tracked blob bytes are read.
const root = fileURLToPath(new URL('../', import.meta.url))
const guard = fileURLToPath(new URL('./repository-hygiene-contract.test.mjs', import.meta.url))
const blob = execFileSync('git', ['rev-parse', 'HEAD:.gitignore'], {
  cwd: root, encoding: 'utf8',
}).trim()

function checkPaths(paths) {
  const dir = mkdtempSync(join(tmpdir(), 'supa-hidden-git-accept-'))
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') }
    const seed = spawnSync('git', ['read-tree', 'HEAD'], { cwd: root, env })
    assert.equal(seed.status, 0, seed.stderr?.toString())
    for (const path of paths) {
      const record = Buffer.concat([
        Buffer.from('100644 ' + blob + ' 0\t'),
        Buffer.from(path, 'utf8'), Buffer.from([0]),
      ])
      const staged = spawnSync('git', ['update-index', '-z', '--index-info'], {
        cwd: root, env, input: record,
      })
      assert.equal(staged.status, 0, staged.stderr?.toString())
    }
    const actual = execFileSync('git', ['ls-files', '-z'], { cwd: root, env })
    for (const path of paths) {
      assert.ok(actual.includes(Buffer.concat([Buffer.from(path), Buffer.from([0])])))
    }
    const childEnv = { ...env }
    delete childEnv.NODE_TEST_CONTEXT
    const run = spawnSync(process.execPath, ['--test', guard], {
      cwd: root, env: childEnv, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
    })
    assert.ifError(run.error)
    return { allowed: run.status === 0, output: (run.stdout || '') + (run.stderr || '') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

for (const [label, path] of [
  ['hidden NBSP-like word joiner in Markdown', 'docs/verslag\u2060.md'],
  ['invisible U+200B inside normal receipt name', 'docs/boodschappen\u200blijst.md'],
  ['soft hyphen hiding a scripts label', 'src/scrip\u00adts/report.js'],
  ['combining grapheme joiner in extension', 'src/overzicht.\u034fmd'],
  ['BOM before ordinary module name', 'src/\ufeffplanner.ts'],
  ['word joiner in a dot-environment prefix', 'src/.e\u2060nv'],
]) {
  test('QA #723 independent: fail hidden Git component ' + label, () => {
    const result = checkPaths([path])
    assert.equal(result.allowed, false, 'unsafe invisible path was accepted\n' + result.output)
    assert.match(result.output, /tracked checkout violates reviewed hygiene contract/)
  })
}

test('QA #723 independent: real combining, joiner, emoji and controls remain allowed', () => {
  const result = checkPaths([
    '.env.example',
    'docs/cafe\u0301.md',
    'docs/پیش\u200cغذا.md',
    'docs/👨‍👩‍👧‍👦-menu.md',
    'docs/één-recept.md',
    'src/weeklyBasket.ts',
    'docs/README.md',
  ])
  assert.equal(result.allowed, true, 'safe path wrongly refused\n' + result.output)
})
