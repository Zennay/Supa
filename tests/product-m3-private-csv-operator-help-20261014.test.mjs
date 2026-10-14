import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../scripts/m3-private-comparison-csv.mjs', import.meta.url))
const privateCanary = 'FICTIONAL_PRIVATE_CSV_PARTICIPANT_CODE_99432'

test('M3 CSV --help guides operator in Dutch without inventing retailer prices', () => {
  const response = spawnSync(process.execPath,
    ['--experimental-strip-types', cli, '--help'], { encoding: 'utf8' })
  assert.equal(response.status, 0, response.stderr)
  assert.equal(response.stderr, '')
  assert.match(response.stdout, /11 boodschappen/)
  assert.match(response.stdout, /--sheet <veldformulier\.json> --output/)
  assert.match(response.stdout, /puntkomma/)
  assert.match(response.stdout, /24 uur/)
  assert.match(response.stdout, /GEEN publieke besparingsclaim/)
  assert.match(response.stdout, /Geen scraping/)
  assert.ok(response.stdout.trim().split('\n').length >= 12)
  assert.doesNotMatch(response.stdout, /participantKey|evidenceId|https?:\/\//)
})

test('M3 CSV --help works in an empty temporary directory with no private output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supa-m3-csv-help-'))
  try {
    const result = spawnSync(process.execPath,
      ['--experimental-strip-types', cli, '--help'],
      { encoding: 'utf8', cwd: dir })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    assert.equal(existsSync(join(dir, 'prijzen.csv')), false)
    assert.doesNotMatch(result.stdout, new RegExp(privateCanary))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('M3 CSV --help with extra private-looking argument fails closed', () => {
  const result = spawnSync(process.execPath,
    ['--experimental-strip-types', cli, '--help', privateCanary],
    { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '')
  assert.doesNotMatch(result.stderr, new RegExp(privateCanary))
  assert.match(result.stderr, /M3 private CSV comparison could not be generated/)
})
