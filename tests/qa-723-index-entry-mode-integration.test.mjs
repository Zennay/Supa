import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// QA #723 independent index-level acceptance: the policy must see actual
// staged modes and merge stages, not merely synthetic in-memory objects.
// This never checks out or reads the contents of test paths.
const root = fileURLToPath(new URL('../', import.meta.url))
const guard = fileURLToPath(new URL('./repository-hygiene-contract.test.mjs', import.meta.url))
const harmlessBlob = execFileSync('git', ['rev-parse', 'HEAD:.gitignore'], {
  cwd: root, encoding: 'utf8',
}).trim()
const harmlessCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root, encoding: 'utf8',
}).trim()

function runGuardWithIndex(entries) {
  const scratch = mkdtempSync(join(tmpdir(), 'supa-723-modes-'))
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') }
    const seed = spawnSync('git', ['read-tree', 'HEAD'], { cwd: root, env })
    assert.equal(seed.status, 0, seed.stderr?.toString())
    const input = Buffer.from(entries.map(({ mode, sha, stage, path }) =>
      mode + ' ' + sha + ' ' + stage + '\t' + path + '\0').join(''))
    const insert = spawnSync('git', ['update-index', '-z', '--index-info'], {
      cwd: root, env, input,
    })
    assert.equal(insert.status, 0, 'could not populate disposable index: ' + insert.stderr?.toString())
    const actual = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root, env })
    for (const entry of entries) {
      const expected = Buffer.from(entry.mode + ' ' + entry.sha + ' ' + entry.stage + '\t' + entry.path + '\0')
      assert.ok(actual.includes(expected), 'requested Git stage was not present: ' + entry.path)
    }
    const childEnv = { ...env }
    delete childEnv.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', guard], {
      cwd: root, env: childEnv, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    return { accepted: child.status === 0, logs: (child.stdout || '') + (child.stderr || '') }
  } finally {
    rmSync(scratch, { force: true, recursive: true })
  }
}

const prefix = '__supa_qa723_mode_matrix__/'
for (const [name, entries, reason] of [
  ['symlink mode', [{ mode: '120000', sha: harmlessBlob, stage: '0', path: prefix + 'symlink' }], /symlink\/gitlink entry/],
  ['gitlink mode', [{ mode: '160000', sha: harmlessCommit, stage: '0', path: prefix + 'submodule' }], /symlink\/gitlink entry/],
  ['unmerged stage 1', [{ mode: '100644', sha: harmlessBlob, stage: '1', path: prefix + 'conflicted.txt' }], /unmerged index entry/],
  ['unmerged stage 2', [{ mode: '100644', sha: harmlessBlob, stage: '2', path: prefix + 'conflicted.txt' }], /unmerged index entry/],
  ['unmerged stage 3', [{ mode: '100644', sha: harmlessBlob, stage: '3', path: prefix + 'conflicted.txt' }], /unmerged index entry/],
]) {
  test('QA #723 real alternate Git index rejects ' + name, () => {
    const result = runGuardWithIndex(entries)
    assert.equal(result.accepted, false, name + ' bypassed checkout hygiene\n' + result.logs)
    assert.match(result.logs, reason, 'must reject for the requested contract reason')
  })
}

test('QA #723 real alternate index permits normal stage-zero blob', () => {
  const result = runGuardWithIndex([
    { mode: '100644', sha: harmlessBlob, stage: '0', path: prefix + 'safe.txt' },
  ])
  assert.equal(result.accepted, true, 'safe blob rejected\n' + result.logs)
})
