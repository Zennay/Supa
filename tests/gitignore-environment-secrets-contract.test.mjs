import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const repoRoot = new URL('..', import.meta.url)

function checkIgnored(path) {
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

  return result.status === 0
}

test('environment secret files remain effectively ignored', () => {
  for (const path of [
    '.env',
    '.env.local',
    '.env.production',
    'nested/.env',
    'nested/.env.test',
  ]) {
    assert.equal(
      checkIgnored(path),
      true,
      `expected environment secret file to remain ignored: ${path}`,
    )
  }
})

test('the safe environment example remains trackable', () => {
  assert.equal(
    checkIgnored('.env.example'),
    false,
    '.env.example must stay available as a committed configuration template',
  )
})
