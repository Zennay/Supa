import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

function inspect(...args) {
  return spawnSync(process.execPath, ['scripts/retailer-physical-civil-clock-cli.mjs', ...args], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 3000,
  })
}

test('offline operator can check a lawful civil timestamp without certification', () => {
  const result = inspect('--check', '2026-10-04T18:08:57.837123456Z')
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    validCivilNotation: true, reviewed: false, sourceRightsVerified: false,
  })
})

test('operator refuses impossible civil UTC and never echoes the supplied capture', () => {
  const invalid = '2026-10-04T18:08:57.837123456-13:00'
  const result = inspect('--check', invalid)
  assert.equal(result.status, 1)
  assert.deepEqual(JSON.parse(result.stdout), {
    validCivilNotation: false, reviewed: false, sourceRightsVerified: false,
  })
  assert.equal((result.stderr + result.stdout).includes(invalid), false)
})

test('operator compares legal aliases but rejects a distinct 1ns recapture', () => {
  const first = '2026-10-04T18:08:57.837123456Z'
  const alias = '2026-10-04T20:08:57.837123456+02:00'
  const different = '2026-10-04T20:08:57.837123457+02:00'
  assert.deepEqual(JSON.parse(inspect('--same', first, alias).stdout), {
    validCivilNotation: true, samePhysicalInstant: true,
    reviewed: false, sourceRightsVerified: false,
  })
  assert.deepEqual(JSON.parse(inspect('--same', first, different).stdout), {
    validCivilNotation: true, samePhysicalInstant: false,
    reviewed: false, sourceRightsVerified: false,
  })
})

test('operator refuses invalid args or invalid member of alias pair', () => {
  const noArgs = inspect()
  assert.equal(noArgs.status, 2)
  assert.equal(noArgs.stdout, '')
  const invalid = inspect('--same', '2026-10-04T18:08:57Z', '2026-10-04T18:08:57-14:00')
  assert.equal(invalid.status, 1)
  assert.equal(JSON.parse(invalid.stdout).samePhysicalInstant, false)
})
