import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { RETAILER_REVIEWED_FIXTURES } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { replayPrivateReviewedCaptureDirectory } from '../scripts/retailer-private-reviewed-manifest-replay.mjs'

// Independent immutable QA acceptance on the real six reviewed M1 JSON files.
// All synthetic tampering occurs ONLY in newly created private temp copies.
const digest = text => createHash('sha256').update(text).digest('hex')
const runner = new URL('../scripts/retailer-private-reviewed-manifest-replay.mjs', import.meta.url).pathname

async function sandbox(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'supa-manifest-duplicate-qa-'))
  const manifest = {
    schemaVersion: 1, mode: 'private-reviewed-retailer-batch',
    productionEnabled: false, permissionVerified: false,
    publicSavingsClaimEligible: false, sources: [],
  }
  try {
    for (const file of RETAILER_REVIEWED_FIXTURES) {
      const data = await readFile(new URL('../fixtures/m1/' + file, import.meta.url))
      const record = JSON.parse(data.toString('utf8'))
      const name = 'capture-' + manifest.sources.length + '.json'
      await writeFile(join(directory, name), data, { flag: 'wx', mode: 0o600 })
      manifest.sources.push({
        file: name, sha256: digest(data),
        key: record.source.supermarket + ':' + record.source.kind,
      })
    }
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest), {
      flag: 'wx', mode: 0o600,
    })
    await fn({ directory, manifest })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
async function manifestText(directory, text) {
  await writeFile(join(directory, 'manifest.json'), text, { mode: 0o600 })
}
async function captureText(directory, manifest, transform) {
  const sourcePath = join(directory, manifest.sources[0].file)
  const original = JSON.parse(await readFile(sourcePath, 'utf8'))
  const canonical = JSON.stringify(original)
  const changed = transform(canonical)
  assert.notEqual(changed, canonical)
  await writeFile(sourcePath, changed, { mode: 0o600 })
  manifest.sources[0].sha256 = digest(changed)
  await manifestText(directory, JSON.stringify(manifest))
}
const deny = async directory => {
  await assert.rejects(
    replayPrivateReviewedCaptureDirectory(directory),
    /Private reviewed retailer capture replay refused/,
    'raw JSON with duplicate keys is ambiguous evidence even if last value passes validation')
  const output = spawnSync(process.execPath, [
    '--experimental-strip-types', runner, '--dir', directory,
  ], { encoding: 'utf8', timeout: 30000, maxBuffer: 65536 })
  assert.equal(output.status, 2, 'unsafe manifest must not be accepted by CLI')
  assert.equal(output.stdout, '', 'no product/source data from ambiguous JSON')
  assert.match(output.stderr, /^Private reviewed retailer capture replay refused\s*$/)
  assert.doesNotMatch(output.stderr, /https?:\/\/|Zuivelmeester|supa-manifest-duplicate-qa-/)
}

test('positive: original six reviewed SHA-linked files replay privately without publishing', () =>
  sandbox(async ({ directory }) => {
    const report = await replayPrivateReviewedCaptureDirectory(directory)
    assert.equal(report.sources, 6)
    assert.equal(report.acceptedSources, 6)
    assert.equal(report.observations, 16)
    assert.equal(report.sixShapeCoverageComplete, true)
    assert.equal(report.productionEnabled, false)
    assert.equal(report.permissionVerified, false)
    assert.equal(report.publicSavingsClaimEligible, false)
  }))

test('manifest with contradictory duplicated permissionVerified keys must fail BEFORE admission', () =>
  sandbox(async ({ directory, manifest }) => {
    const raw = JSON.stringify(manifest)
    const invalid = raw.replace('"permissionVerified":false',
      '"permissionVerified":true,"permissionVerified":false')
    assert.notEqual(invalid, raw)
    await manifestText(directory, invalid)
    await deny(directory)
  }))

test('manifest with duplicated sources keys may not hide an empty/mismatched source set', () =>
  sandbox(async ({ directory, manifest }) => {
    const raw = JSON.stringify(manifest)
    const invalid = raw.replace('"sources":[', '"sources":[],"sources":[')
    assert.notEqual(invalid, raw)
    await manifestText(directory, invalid)
    await deny(directory)
  }))

test('manifest duplicate digest can conceal an unreviewed leading SHA claim', () =>
  sandbox(async ({ directory, manifest }) => {
    const raw = JSON.stringify(manifest)
    const wanted = '"sha256":"' + manifest.sources[0].sha256 + '"'
    const invalid = raw.replace(wanted,
      '"sha256":"' + '0'.repeat(64) + '",' + wanted)
    assert.notEqual(invalid, raw)
    await manifestText(directory, invalid)
    await deny(directory)
  }))

test('source evidence duplicate version cannot launder an initially unapproved adapter envelope', () =>
  sandbox(async ({ directory, manifest }) => {
    await captureText(directory, manifest, raw => raw.replace(
      '"version":1', '"version":999,"version":1'))
    await deny(directory)
  }))

test('source provenance with duplicated supermarket fields is ambiguous despite matching approved SHA bytes', () =>
  sandbox(async ({ directory, manifest }) => {
    await captureText(directory, manifest, raw => raw.replace(
      '"supermarket":"plus"', '"supermarket":"ah","supermarket":"plus"'))
    await deny(directory)
  }))

test('duplicate acquisition safety flag may not hide anti-bot/private access claims', () =>
  sandbox(async ({ directory, manifest }) => {
    await captureText(directory, manifest, raw => raw.replace(
      '"antiBotBypass":false', '"antiBotBypass":true,"antiBotBypass":false'))
    await deny(directory)
  }))
