import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../scripts/m3-private-comparison-html.mjs', import.meta.url))
const privateCanary = 'PRIVATE_M3_FIELD_OWNER_CODE_NOT_TO_LOG_56138'

test('M3 private HTML --help gives human Dutch 11+11 usage and stays unverified', () => {
  const run = spawnSync(process.execPath,
    ['--experimental-strip-types', cli, '--help'], { encoding: 'utf8' })
  assert.equal(run.error, undefined, run.error?.message)
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stderr, '')
  assert.match(run.stdout, /11 boodschappen/)
  assert.match(run.stdout, /PLUS versus DekaMarkt/)
  assert.match(run.stdout, /--sheet <veldformulier\.json> --output <vergelijking\.html>/)
  assert.match(run.stdout, /24 uur/)
  assert.match(run.stdout, /geen onafhankelijk geverifieerde besparingsclaim/)
  assert.ok(run.stdout.split('\n').length >= 14)
  assert.doesNotMatch(run.stdout, /https?:\/\/|evidenceId|participantKey/)
})

test('M3 --help runs without reading local private files or creating output', () => {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-private-help-'))
  const old = process.cwd()
  try {
    const run = spawnSync(process.execPath,
      ['--experimental-strip-types', cli, '--help'],
      { encoding: 'utf8', cwd: root })
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.stderr, '')
    assert.equal(existsSync(join(root, 'vergelijking.html')), false)
    assert.doesNotMatch(run.stdout, new RegExp(privateCanary))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('M3 help never lets option-like private tokens trigger read or output', () => {
  const run = spawnSync(process.execPath,
    ['--experimental-strip-types', cli, '--help', privateCanary],
    { encoding: 'utf8' })
  assert.notEqual(run.status, 0)
  assert.equal(run.stdout, '')
  assert.doesNotMatch(run.stderr, new RegExp(privateCanary))
  assert.match(run.stderr, /private HTML comparison could not be generated/)
})
