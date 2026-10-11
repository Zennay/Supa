import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent follow-up #723. Test the real staged QA guard via alternate
// Git indices only. Synthetic path names; no secret contents are opened.
const cwd = fileURLToPath(new URL('../', import.meta.url))
const guard = fileURLToPath(new URL('./repository-hygiene-contract.test.mjs', import.meta.url))
const blobSha = execFileSync('git', ['rev-parse', 'HEAD:.gitignore'], {
  cwd, encoding: 'utf8',
}).trim()

function review(paths) {
  const temp = mkdtempSync(join(tmpdir(), 'supa-case-postrepair-'))
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(temp, 'index') }
    const git = (args) => {
      const r = spawnSync('git', args, { cwd, env, encoding: 'utf8' })
      assert.equal(r.error, undefined)
      assert.equal(r.status, 0, `unable to stage test metadata: ${r.stderr}`)
    }
    git(['read-tree', 'HEAD'])
    for (const path of paths) {
      git(['update-index', '--add', '--cacheinfo', `100644,${blobSha},${path}`])
    }
    const index = execFileSync('git', ['ls-files', '--stage', '-z'], {
      cwd, env, encoding: 'utf8',
    })
    for (const path of paths) {
      assert.ok(index.includes(`\t${path}\0`),
        `index must contain synthetic path: ${path}`)
    }
    const childEnv = { ...env }
    delete childEnv.NODE_TEST_CONTEXT
    const r = spawnSync(process.execPath, ['--test', guard], {
      cwd, env: childEnv, encoding: 'utf8', maxBuffer: 1024 * 1024,
    })
    assert.equal(r.error, undefined)
    return { status: r.status, text: r.stdout + r.stderr }
  } finally {
    rmSync(temp, { force: true, recursive: true })
  }
}

function invalid(path) {
  const r = review([path])
  assert.notEqual(r.status, 0,
    `case-insensitive checkout bypass: ${path}; ${r.text.slice(-750)}`)
  assert.match(r.text, /tracked checkout violates reviewed hygiene contract/,
    `actual tracked-path guard must enforce policy: ${path}`)
}

test('QA #723: prevent exact .env.example exception from becoming a mixed-case loophole', () => {
  for (const p of [
    '.Env.Example', 'src/.ENV.EXAMPLE', 'notes/.eNv.example',
    'docs/.ENV.Stage', 'src/.eNv',
  ]) invalid(p)
})

test('QA #723: defend deeply nested case-aliased ignored directories and suffixes', () => {
  for (const p of [
    'src/shared/ArTiFaCtS/m3/study.json',
    'docs/.VsCoDe/settings.json',
    'src/NoDe_MoDuLeS/temp.js',
    'docs/archive/report.LoG',
    'scripts/build.TsBuIlDiNfO',
    'Vite.Config.D.Ts',
  ]) invalid(p)
})

test('QA #723: allow precisely named .env.example and normal case-variant documents', () => {
  for (const p of [
    '.env.example', 'docs/.env.example',
    'src/EnvFileNames.ts', 'docs/Vite.Config.js',
    'docs/Build.Logbook.md', 'src/distinctItem.ts',
    'notes/ARTIFACTS-INFO.md',
  ]) {
    const r = review([p])
    assert.equal(r.status, 0,
      `unexpected path overblocking: ${p}; ${r.text.slice(-1200)}`)
  }
})
