import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent postrepair acceptance for QA #1801: use temporary Git metadata.
// Reuse only public .gitignore blob ID; never inspect payloads or real evidence.
const root = fileURLToPath(new URL('../', import.meta.url))
const guard = fileURLToPath(new URL('./repository-hygiene-contract.test.mjs', import.meta.url))
const blob = execFileSync('git', ['rev-parse', 'HEAD:.gitignore'], {
  cwd: root, encoding: 'utf8',
}).trim()

function check(names) {
  const dir = mkdtempSync(join(tmpdir(), 'supa-qa-1801-accept-'))
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') }
    const result = spawnSync('git', ['read-tree', 'HEAD'], { cwd: root, env })
    assert.equal(result.status, 0, result.stderr?.toString())
    for (const name of names) {
      const staged = spawnSync('git', ['update-index', '-z', '--index-info'], {
        cwd: root, env, input: Buffer.concat([
          Buffer.from('100644 ' + blob + ' 0\t'),
          Buffer.from(name, 'utf8'), Buffer.from([0]),
        ]),
      })
      assert.equal(staged.status, 0, staged.stderr?.toString())
      const index = execFileSync('git', ['ls-files', '-z'], { cwd: root, env })
      assert.ok(index.includes(Buffer.concat([Buffer.from(name), Buffer.from([0])])))
    }
    const childEnv = { ...env }
    delete childEnv.NODE_TEST_CONTEXT
    const run = spawnSync(process.execPath, ['--test', guard], {
      cwd: root, env: childEnv, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
    })
    assert.ifError(run.error)
    return { permitted: run.status === 0, log: (run.stdout || '') + (run.stderr || '') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

for (const [label, name] of [
  ['leading NEL inside valid docs component', 'docs/\u0085werkweek.md'],
  ['NEL before extension', 'docs/basket\u0085.json'],
  ['paragraph separator between directory names', 'docs/onderzoek\u2029samen/analysis.md'],
  ['line separator in a hidden-filename suffix', 'src/.hidden\u2028name.ts'],
  ['paragraph separator before dot extension', 'src/week\u2029.ts'],
  ['line separator at start of a nested component', 'src/planner/\u2028week.ts'],
]) {
  test('QA #1801 independent acceptance refuses ' + label, () => {
    const result = check([name])
    assert.equal(result.permitted, false, 'unexpectedly permitted Unicode separator\n' + result.log)
    assert.match(result.log, /tracked checkout violates reviewed hygiene contract/)
  })
}

test('QA #1801 independent acceptance preserves ordinary multilingual filenames', () => {
  const result = check([
    '.env.example',
    'docs/week\u00a0menu.md',
    'docs/résumé.md',
    'docs/cafe\u0301.md',
    'docs/כותרת.md',
    'docs/پیش\u200cغذا.md',
    'docs/👩‍🍳-diner.md',
    'src/domain/week.ts',
  ])
  assert.equal(result.permitted, true, 'ordinary filenames rejected\n' + result.log)
})
