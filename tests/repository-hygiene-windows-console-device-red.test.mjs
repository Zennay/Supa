import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent #723 RED: Windows console device aliases. Only synthetic paths
// enter an isolated Git index. No physical files, credentials, or field data.
const cwd = fileURLToPath(new URL('../', import.meta.url))
const guard = fileURLToPath(new URL('./repository-hygiene-contract.test.mjs', import.meta.url))
const dummyBlob = execFileSync('git', ['rev-parse', 'HEAD:.gitignore'], {
  cwd, encoding: 'utf8',
}).trim()

function validateSyntheticPath(path) {
  const scratch = mkdtempSync(join(tmpdir(), 'supa-console-device-'))
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') }
    const git = (args) => {
      const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' })
      assert.equal(result.error, undefined)
      assert.equal(result.status, 0, `Git index setup failed: ${result.stderr}`)
    }
    git(['read-tree', 'HEAD'])
    git(['update-index', '--add', '--cacheinfo', `100644,${dummyBlob},${path}`])
    const staged = execFileSync('git', ['ls-files', '--stage', '-z'], {
      cwd, env, encoding: 'utf8',
    })
    assert.ok(staged.includes(`\t${path}\0`), 'synthetic path must actually be staged')
    const childEnv = { ...env }
    delete childEnv.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', guard], {
      cwd, env: childEnv, encoding: 'utf8', maxBuffer: 1024 * 1024,
    })
    assert.equal(result.error, undefined)
    assert.notEqual(result.status, null)
    return { status: result.status, output: result.stdout + result.stderr }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

test('QA #723: reserved Windows CONIN$ and CONOUT$ names fail the real index gate', () => {
  for (const path of ['CONIN$', 'CONOUT$', 'docs/conin$', 'src/CoNoUt$']) {
    const result = validateSyntheticPath(path)
    assert.notEqual(result.status, 0,
      `Windows console device alias escaped: ${path}; ${result.output.slice(-900)}`)
    assert.match(result.output, /tracked checkout violates reviewed hygiene contract/,
      `must fail at tracked-path check: ${path}`)
  }
})

test('QA #723: console aliases remain reserved with ordinary extensions', () => {
  for (const path of ['docs/CONIN$.md', 'src/coNoUt$.json']) {
    const result = validateSyntheticPath(path)
    assert.notEqual(result.status, 0,
      `Windows console device extension escaped: ${path}; ${result.output.slice(-900)}`)
    assert.match(result.output, /tracked checkout violates reviewed hygiene contract/)
  }
})

test('QA #723: do not overblock ordinary near-miss names or legal device digit zero', () => {
  for (const path of [
    'docs/CONINNER.md', 'src/CONOUTER.ts', 'notes/conin-dollar.md',
    'docs/COM0.md', 'docs/LPT0.txt', 'src/connectors.ts',
  ]) {
    const result = validateSyntheticPath(path)
    assert.equal(result.status, 0,
      `valid ordinary path incorrectly blocked: ${path}; ${result.output.slice(-900)}`)
  }
})
