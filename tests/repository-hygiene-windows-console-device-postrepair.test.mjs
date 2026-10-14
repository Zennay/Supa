import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent postrepair matrix for #723; exercise the real staged index gate.
// Never create device-named files or inspect file contents/retailer evidence.
const cwd = fileURLToPath(new URL('../', import.meta.url))
const guard = fileURLToPath(new URL('./repository-hygiene-contract.test.mjs', import.meta.url))
const placeholder = execFileSync('git', ['rev-parse', 'HEAD:.gitignore'], {
  cwd, encoding: 'utf8',
}).trim()

function check(path) {
  const scratch = mkdtempSync(join(tmpdir(), 'supa-consoles-accept-'))
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') }
    for (const args of [
      ['read-tree', 'HEAD'],
      ['update-index', '--add', '--cacheinfo', `100644,${placeholder},${path}`],
    ]) {
      const r = spawnSync('git', args, { cwd, env, encoding: 'utf8' })
      assert.equal(r.error, undefined)
      assert.equal(r.status, 0, `could not stage synthetic metadata: ${r.stderr}`)
    }
    const index = execFileSync('git', ['ls-files', '--stage', '-z'], {
      cwd, env, encoding: 'utf8',
    })
    assert.ok(index.includes(`\t${path}\0`), `missing synthetic index entry: ${path}`)
    const childEnv = { ...env }
    delete childEnv.NODE_TEST_CONTEXT
    const r = spawnSync(process.execPath, ['--test', guard], {
      cwd, env: childEnv, encoding: 'utf8', maxBuffer: 1024 * 1024,
    })
    assert.equal(r.error, undefined)
    return { ok: r.status === 0, output: r.stdout + r.stderr }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

test('QA #723: postrepair blocks case variants in deeply nested console device stems', () => {
  for (const path of [
    'archive/CONIN$', 'docs/CoNiN$', 'src/generated/conin$.json',
    'docs/COnOuT$', 'src/models/conout$.txt', 'archive/deep/CONOUT$.test.js',
  ]) {
    const r = check(path)
    assert.equal(r.ok, false, `reserved alias accepted: ${path}; ${r.output.slice(-750)}`)
    assert.match(r.output, /tracked checkout violates reviewed hygiene contract/,
      `invalid result must come from real index hygiene contract: ${path}`)
  }
})

test('QA #723: postrepair catches padded console stems before extensions', () => {
  for (const path of ['docs/CONIN$ .md', 'src/CONOUT$  .txt']) {
    const r = check(path)
    assert.equal(r.ok, false, `padded reserved alias accepted: ${path}`)
    assert.match(r.output, /tracked checkout violates reviewed hygiene contract/)
  }
})

test('QA #723: postrepair admits unrelated dollar names and nondevice lookalikes', () => {
  for (const path of [
    'docs/CONIN.md', 'docs/conout.md',
    'src/conin$more.ts', 'src/conout$backup.json',
    'docs/CONIN$$.md', 'docs/my-conout$.md',
    'src/CONNECTION.ts', 'docs/COM0.txt',
  ]) {
    const r = check(path)
    assert.equal(r.ok, true, `valid name rejected: ${path}; ${r.output.slice(-1000)}`)
  }
})
