import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const repoRoot = new URL('..', import.meta.url)
const ignoreLines = readFileSync(
  new URL('../.gitignore', import.meta.url),
  'utf8',
)
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)

function gitCheckIgnore(path) {
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

  return result
}

test('local environment ignore rules remain ordered safely', () => {
  const envIndex = ignoreLines.indexOf('.env')
  const envWildcardIndex = ignoreLines.indexOf('.env.*')
  const exampleExceptionIndex = ignoreLines.indexOf('!.env.example')

  assert.notEqual(envIndex, -1, '.env must remain ignored')
  assert.notEqual(envWildcardIndex, -1, '.env.* must remain ignored')
  assert.notEqual(
    exampleExceptionIndex,
    -1,
    '.env.example must remain explicitly allowed',
  )
  assert.ok(
    exampleExceptionIndex > envWildcardIndex,
    '.env.example exception must come after the .env.* ignore rule',
  )
})

test('local environment files remain effectively ignored by Git', () => {
  for (const path of [
    '.env',
    '.env.local',
    '.env.production',
    '.env.development.local',
  ]) {
    const result = gitCheckIgnore(path)
    assert.equal(
      result.status,
      0,
      `expected Git to ignore ${path}; stderr=${result.stderr.trim() || '<empty>'}`,
    )
  }
})

test('the environment example remains effectively trackable by Git', () => {
  const result = gitCheckIgnore('.env.example')

  assert.equal(
    result.status,
    1,
    `expected .env.example to stay trackable; stderr=${result.stderr.trim() || '<empty>'}`,
  )
})
