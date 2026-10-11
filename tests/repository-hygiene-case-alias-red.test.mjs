import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent synthetic expected-RED for #723. Uses only a disposable
// alternate Git index and the existing committed .gitignore blob as a dummy.
// Never creates or inspects a secret, source snapshot or fake evidence file.
const root = fileURLToPath(new URL('../', import.meta.url))
const guard = fileURLToPath(new URL('./repository-hygiene-contract.test.mjs', import.meta.url))
const harmlessBlob = execFileSync('git', ['rev-parse', 'HEAD:.gitignore'], {
  cwd: root, encoding: 'utf8',
}).trim()

function runActualGuardFor(path) {
  const scratch = mkdtempSync(join(tmpdir(), 'supa-case-alias-'))
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') }
    function git(...args) {
      const done = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' })
      assert.equal(done.error, undefined)
      assert.equal(done.status, 0, `git ${args[0]} failed: ${done.stderr}`)
    }
    git('read-tree', 'HEAD')
    git('update-index', '--add', '--cacheinfo', `100644,${harmlessBlob},${path}`)
    const staged = execFileSync('git', ['ls-files', '--stage', '-z'], {
      cwd: root, env, encoding: 'utf8',
    })
    assert.ok(staged.includes(`\t${path}\0`), 'synthetic tracked path must exist in alternate index')
    const childEnv = { ...env }
    delete childEnv.NODE_TEST_CONTEXT
    const done = spawnSync(process.execPath, ['--test', guard], {
      cwd: root, env: childEnv, encoding: 'utf8', maxBuffer: 1024 * 1024,
    })
    assert.equal(done.error, undefined)
    return { status: done.status, output: done.stdout + done.stderr }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

function mustReject(path) {
  const result = runActualGuardFor(path)
  assert.notEqual(result.status, 0,
    `accepted case-alias tracked path ${path}: ${result.output.slice(-900)}`)
  assert.match(result.output, /tracked checkout violates reviewed hygiene contract/,
    `denial must come from actual tracked-file hygiene for ${path}`)
}

test('QA #723: reject uppercase/mixed-case .env and macOS metadata aliases', () => {
  for (const path of [
    '.ENV', 'src/.Env.LOCAL', 'config/.ENV.production',
    'src/.DS_STORE', 'src/.ds_store',
  ]) mustReject(path)
})

test('QA #723: reject Windows-case-aliased ignored build and IDE directories', () => {
  for (const path of [
    'NODE_MODULES/fake.js', 'src/Node_Modules/file.js',
    'DiSt/bundle.js', 'ArtIfacts/m3/report.json',
    '.VSCODE/settings.json', '.IDEA/workspace.xml',
  ]) mustReject(path)
})

test('QA #723: reject mixed-case local logs and generated build files', () => {
  for (const path of [
    'logs/TRACE.LOG', 'src/Build.TSBUILDINFO',
    'VITE.CONFIG.JS', 'VITE.CONFIG.D.TS',
  ]) mustReject(path)
})

test('QA #723: preserve legitimate mixed-case tracked paths and exact shareable example', () => {
  for (const path of [
    '.env.example', 'docs/LOGO.md', 'docs/DISTILLATION.md',
    'src/moduleList.ts', 'docs/EnvironmentGuide.md',
  ]) {
    const result = runActualGuardFor(path)
    assert.equal(result.status, 0,
      `non-secret ordinary path must remain trackable: ${path}; ${result.output.slice(-1100)}`)
  }
})
