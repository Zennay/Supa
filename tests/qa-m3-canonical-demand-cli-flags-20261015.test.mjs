import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalM3RetailerRequirements } from '../scripts/retailer-canonical-m3-demand.mjs'

/**
 * Independent QA for the just-landed M3 planner -> offline-retailer bridge.
 * The exported file is not a shopper observation or real retailer evidence.
 * Run the actual CLI in a child process so a malformed --out never leaves
 * a stray flag-shaped file in the repo working directory.
 */
const cli = fileURLToPath(new URL('../scripts/retailer-canonical-m3-demand.mjs', import.meta.url))
const invoke = (cwd, args) => spawnSync(
  process.execPath,
  ['--experimental-strip-types', cli, ...args],
  { cwd, encoding: 'utf8', timeout: 20_000 },
)

test('M3 --out does not treat a second option token as a private output filename', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-cli-qa-'))
  t.after(() => rm(directory, { recursive: true, force: true }))

  for (const flag of ['--force', '--overwrite', '--out', '--help', '-']) {
    const result = invoke(directory, ['--out', flag])
    assert.equal(result.error, undefined, result.error?.message)
    assert.notEqual(result.status, 0, `--out ${flag} must be rejected, not accepted as a file`)
    assert.equal(existsSync(join(directory, flag)), false, `rejected ${flag} must not leave a file`)
    assert.equal(result.stdout.includes('Private M3 eleven-line requirements created'), false)
  }
})

test('M3 --out still accepts an explicit absolute path with a flag-looking basename', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-cli-qa-'))
  t.after(() => rm(directory, { recursive: true, force: true }))

  const destination = join(directory, '--force')
  const result = invoke(directory, ['--out', destination])
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(await readFile(destination, 'utf8')), canonicalM3RetailerRequirements())
  assert.equal((await stat(destination)).mode & 0o777, 0o600)
})

test('M3 no-argument stdout stays exactly a price-free, person-free canonical demand', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-cli-qa-'))
  t.after(() => rm(directory, { recursive: true, force: true }))

  const result = invoke(directory, [])
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  assert.equal(result.stdout, JSON.stringify(canonicalM3RetailerRequirements(), null, 2) + '\n')
  assert.equal(JSON.parse(result.stdout).length, 11)
  for (const forbidden of ['priceCents', 'participantKey', 'sourceUrl', 'observedAt', 'evidenceId']) {
    assert.equal(result.stdout.includes(forbidden), false)
  }
  assert.equal(existsSync(join(directory, '--force')), false)
})
