import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent issue #723 acceptance. All candidates are synthetic Git paths.
// Never create those paths in the checkout or read their file contents.
// A disposable alternate GIT_INDEX_FILE lets us exercise the actual QA guard
// rather than duplicating its path-checking implementation.
const root = fileURLToPath(new URL('../', import.meta.url))
const hygieneTest = fileURLToPath(new URL('./repository-hygiene-contract.test.mjs', import.meta.url))
const existingBlob = execFileSync('git', ['rev-parse', 'HEAD:.gitignore'], {
  cwd: root, encoding: 'utf8',
}).trim()

function gitResult(args, env) {
  const result = spawnSync('git', args, {
    cwd: root, env, encoding: 'utf8', maxBuffer: 1024 * 1024,
  })
  assert.equal(result.error, undefined, 'Git metadata command must execute')
  assert.equal(result.status, 0,
    `Git metadata setup failed: ${args[0]}: ${result.stderr.trim()}`)
}

function runHygieneAgainstSyntheticIndex(paths) {
  const scratch = mkdtempSync(join(tmpdir(), 'supa-hygiene-acceptance-'))
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') }
    // HEAD is copied into an alternate index, never into the real repository
    // index. Use a committed, non-sensitive blob as an inert path placeholder.
    gitResult(['read-tree', 'HEAD'], env)
    for (const path of paths) {
      gitResult(['update-index', '--add', '--cacheinfo',
        `100644,${existingBlob},${path}`], env)
    }
    const tracked = execFileSync('git', ['ls-files', '--stage', '-z'], {
      cwd: root, env, encoding: 'utf8',
    })
    for (const path of paths) {
      assert.ok(tracked.includes(`\\t${path}\\0`),
        `alternate index did not stage synthetic path: ${path}`)
    }
    const result = spawnSync(process.execPath,
      ['--test', hygieneTest], {
        cwd: root, env, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
      })
    assert.equal(result.error, undefined, 'Child QA guard must execute')
    return { status: result.status, output: result.stdout + result.stderr }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

test('QA #723: reject Windows COM/LPT superscript-digit device names', () => {
  // Windows reserves COM¹/COM²/COM³ and LPT¹/LPT²/LPT³, including extensions.
  // Ordinary ASCII-only reserved-name regexes miss these Windows device names.
  for (const path of [
    'docs/COM¹.txt',
    'docs/COM².md',
    'docs/COM³',
    'docs/LPT¹.cfg',
    'docs/LPT².txt',
    'docs/LPT³',
  ]) {
    const result = runHygieneAgainstSyntheticIndex([path])
    assert.notEqual(result.status, 0,
      `portable tracked-path gate accepted reserved Windows device: ${path}; child: ${result.output.slice(-1600)}`)
    assert.match(result.output, /tracked checkout violates reviewed hygiene contract/,
      `reserved-name failure must come from tracked-path hygiene: ${path}`)
  }
})

test('QA #723: reject Unicode full-casefold collisions after NFC', () => {
  const collisions = [
    ['docs/straße.md', 'docs/strasse.md'],
    ['src/ſample.ts', 'src/sample.ts'],
    ['docs/σ.md', 'docs/ς.md'],
  ]
  for (const paths of collisions) {
    const result = runHygieneAgainstSyntheticIndex(paths)
    assert.notEqual(result.status, 0,
      `casefold collision was accepted: ${paths.join(' versus ')}; child: ${result.output.slice(-1600)}`)
    assert.match(result.output, /tracked checkout violates reviewed hygiene contract/,
      'collision failure must come from tracked-path hygiene')
  }
})

test('QA #723: keep unrelated valid Unicode paths portable', () => {
  const result = runHygieneAgainstSyntheticIndex([
    'docs/maaltijdplanning.md',
    'docs/één-week.md',
    'src/ingredientlijst.ts',
  ])
  assert.equal(result.status, 0,
    'valid NFC Unicode paths must not be rejected by the tracked-path gate')
})
