import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent post-repair acceptance for issue #723. This creates only a
// disposable alternate Git *index*; no synthetic path is written to checkout.
const root = fileURLToPath(new URL('../', import.meta.url))
const guard = fileURLToPath(new URL('./repository-hygiene-contract.test.mjs', import.meta.url))
const blob = execFileSync('git', ['rev-parse', 'HEAD:.gitignore'], {
  cwd: root, encoding: 'utf8',
}).trim()

function executeGuardWithEntries(paths) {
  const temp = mkdtempSync(join(tmpdir(), 'supa-path-acceptance-'))
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(temp, 'index') }
    const git = (args) => {
      const done = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' })
      assert.equal(done.error, undefined)
      assert.equal(done.status, 0, `Git index setup: ${done.stderr}`)
    }
    git(['read-tree', 'HEAD'])
    for (const path of paths) {
      git(['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`])
    }
    const tracked = execFileSync('git', ['ls-files', '--stage', '-z'], {
      cwd: root, env, encoding: 'utf8',
    })
    for (const path of paths) {
      assert.ok(tracked.includes(`\t${path}\0`),
        `synthetic Git index must retain: ${path}`)
    }
    const childEnv = { ...env }
    delete childEnv.NODE_TEST_CONTEXT // Prevent nested Node --test skip.
    const done = spawnSync(process.execPath, ['--test', guard], {
      cwd: root, env: childEnv, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
    })
    assert.equal(done.error, undefined)
    return { code: done.status, output: done.stdout + done.stderr }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

test('QA #723: postrepair rejects compatibility-width and ligature collisions', () => {
  for (const paths of [
    ['src/ﬃ.ts', 'src/ffi.ts'],
    ['docs/Ａ.md', 'docs/A.md'],
    ['docs/Ⅳ.md', 'docs/IV.md'],
  ]) {
    const result = executeGuardWithEntries(paths)
    assert.notEqual(result.code, 0, `accepted compatibility collision: ${paths.join(' / ')}`)
    assert.match(result.output, /tracked checkout violates reviewed hygiene contract/,
      'the real checkout hygiene assertion must reject the indexed collision')
  }
})

test('QA #723: postrepair rejects Windows device names padded before extensions', () => {
  for (const path of [
    'docs/COM  .txt',
    'docs/LPT³  .txt',
    'docs/NUL .md',
  ]) {
    const result = executeGuardWithEntries([path])
    assert.notEqual(result.code, 0, `accepted reserved Windows name: ${path}`)
    assert.match(result.output, /tracked checkout violates reviewed hygiene contract/,
      'actual checked-out Git path guard must reject the device alias')
  }
})

test('QA #723: ordinary Unicode, distinct accents and nondevice names remain valid', () => {
  const result = executeGuardWithEntries([
    'docs/café.md',
    'docs/cafe.md',
    'docs/COM0.txt',
    'docs/LPT0.txt',
    'docs/maaltijden-voor-één.md',
  ])
  assert.equal(result.code, 0,
    `valid Unicode path control was overblocked: ${result.output.slice(-1700)}`)
})
