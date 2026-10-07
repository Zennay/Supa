import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const repoRoot = new URL('..', import.meta.url)

function assertIgnored(path) {
  const result = spawnSync(
    'git',
    ['check-ignore', '--no-index', '--quiet', '--', path],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  )

  assert.equal(
    result.error,
    undefined,
    `failed to execute git check-ignore for ${path}: ${result.error?.message ?? 'unknown error'}`,
  )
  assert.equal(
    result.status,
    0,
    `expected .gitignore to ignore ${path}; stderr=${result.stderr.trim() || '<empty>'}`,
  )
}

test('generated dependency, build and compiler artifacts remain effectively ignored', () => {
  for (const path of [
    'node_modules/example.js',
    'dist/index.js',
    'supa-validation.log',
    'tsconfig.tsbuildinfo',
    'vite.config.js',
    'vite.config.d.ts',
  ]) {
    assertIgnored(path)
  }
})
