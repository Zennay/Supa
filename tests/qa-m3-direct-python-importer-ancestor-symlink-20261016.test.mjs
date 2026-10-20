/**
 * SUPA M3 independent quality-validation 2/2 — standalone Python SQLite
 * importer's filesystem ancestry, distinct from JS wrapper preflight.
 * Frozen fixed product owner #3235 SHA 0d3273efd1c06ca7b8f36e34b678a6a26ea58ac6.
 * All files are private disposable, six real previously reviewed local
 * PLUS/Deka historical fixtures only. No HTTP, actual prices or source rights.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, mkdir, symlink, stat, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'

const IMPORTER = fileURLToPath(new URL('../scripts/retailer-import-universal-sqlite.py', import.meta.url))
const REFUSAL = /Universal offline retailer database import refused; nothing published/

async function withSandbox(verify) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-direct-python-ancestor-'))
  try {
    const source = join(root, 'approved.json')
    await writeFile(source, JSON.stringify(await loadReviewedRepositoryFixtures()), {
      flag: 'wx', mode: 0o600,
    })
    const real = join(root, 'private')
    const alias = join(root, 'symlink-alias')
    await mkdir(real, { mode: 0o700 })
    await symlink(real, alias, 'dir')
    const run = (input, output) => spawnSync('python3',
      [IMPORTER, '--input', input, '--out', output],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 })
    await verify({ root, source, real, alias, run })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

async function assertAbsent(file) {
  await assert.rejects(stat(file), { code: 'ENOENT' })
}
function assertPrivateRefusal(child) {
  assert.notEqual(child.status, 0)
  assert.equal(child.stdout, '')
  assert.match(child.stderr, REFUSAL)
  assert.doesNotMatch(child.stderr,
    /symlink-alias|approved\.json|access_token|https?:\/\/|sourceProductId|price_cents/i)
}

test('direct Python importer positive: genuine offline six-source DB in ordinary private folder', async () =>
  withSandbox(async ({ source, real, run }) => {
    const output = join(real, 'historical.sqlite')
    const child = run(source, output)
    assert.equal(child.status, 0, child.stderr)
    const report = JSON.parse(child.stdout)
    assert.equal(report.created, true)
    assert.equal(report.snapshots, 6)
    assert.equal(report.productionEnabled, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal((await stat(output)).mode & 0o777, 0o600)
  }))

test('direct Python importer refuses existing output symlink without touching target file', async () =>
  withSandbox(async ({ root, source, real, run }) => {
    const existing = join(real, 'existing.txt')
    const bytes = Buffer.from('FICTIONAL QA existing private data')
    await writeFile(existing, bytes, { flag: 'wx', mode: 0o600 })
    const alias = join(root, 'output.sqlite')
    await symlink(existing, alias, 'file')
    assertPrivateRefusal(run(source, alias))
    assert.deepEqual(await readFile(existing), bytes)
  }))

test('direct Python importer rejects destination through symlink parent [EXPECTED RED]', async () =>
  withSandbox(async ({ source, real, alias, run }) => {
    const output = join(alias, 'must-not-exist.sqlite')
    assertPrivateRefusal(run(source, output))
    await assertAbsent(join(real, 'must-not-exist.sqlite'))
  }))

test('direct Python importer rejects deeply nested destination through symlink ancestor [EXPECTED RED]', async () =>
  withSandbox(async ({ source, real, alias, run }) => {
    await mkdir(join(real, 'nested'), { mode: 0o700 })
    const output = join(alias, 'nested', 'must-not-exist.sqlite')
    assertPrivateRefusal(run(source, output))
    await assertAbsent(join(real, 'nested', 'must-not-exist.sqlite'))
  }))

test('direct Python importer rejects input reached through symlink parent [EXPECTED RED]', async () =>
  withSandbox(async ({ root, source, real, alias, run }) => {
    const actual = join(real, 'input.json')
    await writeFile(actual, await readFile(source), { flag: 'wx', mode: 0o600 })
    const output = join(root, 'must-not-exist.sqlite')
    assertPrivateRefusal(run(join(alias, 'input.json'), output))
    await assertAbsent(output)
  }))
