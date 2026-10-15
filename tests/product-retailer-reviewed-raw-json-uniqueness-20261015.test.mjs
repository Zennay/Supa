import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { replayPrivateReviewedCaptureDirectory } from '../scripts/retailer-private-reviewed-manifest-replay.mjs'
import { RETAILER_REVIEWED_FIXTURES } from '../scripts/retailer-reviewed-ingest-engine.mjs'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

async function withReviewedFiles(run) {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-raw-duplicates-'))
  const manifest = {
    schemaVersion: 1, mode: 'private-reviewed-retailer-batch',
    productionEnabled: false, permissionVerified: false,
    publicSavingsClaimEligible: false, sources: [],
  }
  try {
    for (const name of RETAILER_REVIEWED_FIXTURES) {
      const bytes = await readFile(new URL('../fixtures/m1/' + name, import.meta.url))
      const record = JSON.parse(bytes.toString('utf8'))
      const file = 'capture-' + manifest.sources.length + '.json'
      await writeFile(join(root, file), bytes, { mode: 0o600, flag: 'wx' })
      manifest.sources.push({ file, sha256: sha256(bytes),
        key: record.source.supermarket + ':' + record.source.kind })
    }
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600, flag: 'wx' })
    await run({ root, manifest })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
const manifestRaw = async (root, raw) =>
  writeFile(join(root, 'manifest.json'), raw, { mode: 0o600 })
async function sourceRaw(root, manifest, mutate) {
  const path = join(root, manifest.sources[0].file)
  const original = (await readFile(path)).toString('utf8')
  const modified = mutate(original)
  assert.notEqual(modified, original, 'mutant must change the source bytes')
  await writeFile(path, modified, { mode: 0o600 })
  manifest.sources[0].sha256 = sha256(modified)
  await manifestRaw(root, JSON.stringify(manifest))
}
const denied = root => assert.rejects(
  replayPrivateReviewedCaptureDirectory(root),
  /^Error: Private reviewed retailer capture replay refused$/,
)

test('product raw duplicate gate retains six valid historical reviewed source records', () =>
  withReviewedFiles(async ({ root }) => {
    const report = await replayPrivateReviewedCaptureDirectory(root)
    assert.equal(report.sources, 6)
    assert.equal(report.acceptedSources, 6)
    assert.equal(report.sixShapeCoverageComplete, true)
    assert.equal(report.permissionVerified, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.externalRequests, 0)
  }))

test('product gate rejects duplicate root permission and source array, not just last value', () =>
  withReviewedFiles(async ({ root, manifest }) => {
    let raw = JSON.stringify(manifest).replace(
      '"permissionVerified":false', '"permissionVerified":true,"permissionVerified":false')
    await manifestRaw(root, raw)
    await denied(root)
    raw = JSON.stringify(manifest).replace('"sources":[',
      '"sources":[],"sources":[')
    await manifestRaw(root, raw)
    await denied(root)
  }))

test('product gate rejects duplicate digest inside nested source entry', () =>
  withReviewedFiles(async ({ root, manifest }) => {
    const actual = manifest.sources[0].sha256
    const raw = JSON.stringify(manifest).replace('"sha256":"' + actual + '"',
      '"sha256":"' + '0'.repeat(64) + '","sha256":"' + actual + '"')
    await manifestRaw(root, raw)
    await denied(root)
  }))

test('product gate refuses duplicate raw adapter version even when SHA is recomputed', () =>
  withReviewedFiles(async ({ root, manifest }) => {
    await sourceRaw(root, manifest, text => text.replace(
      '"version": 1', '"version": 999, "version": 1').replace(
      '"version":1', '"version":999,"version":1'))
    await denied(root)
  }))

test('product gate refuses duplicate source retailer and nested acquisition safety', () =>
  withReviewedFiles(async ({ root, manifest }) => {
    await sourceRaw(root, manifest, text => text.replace(
      '"supermarket": "plus"', '"supermarket": "ah", "supermarket": "plus"').replace(
      '"supermarket":"plus"', '"supermarket":"ah","supermarket":"plus"'))
    await denied(root)
  }))
test('product gate rejects duplicate deeply nested safety flag despite correct capture SHA', () =>
  withReviewedFiles(async ({ root, manifest }) => {
    await sourceRaw(root, manifest, text => text.replace(
      '"antiBotBypass": false', '"antiBotBypass": true, "antiBotBypass": false').replace(
      '"antiBotBypass":false', '"antiBotBypass":true,"antiBotBypass":false'))
    await denied(root)
  }))

test('escaped property names and whitespace are resolved before duplicate detection', () =>
  withReviewedFiles(async ({ root, manifest }) => {
    const raw = JSON.stringify(manifest).replace(
      '"permissionVerified":false',
      '"permissionVerified":true, "permission\\u0056erified" \n : false')
    await manifestRaw(root, raw)
    await denied(root)
  }))

test('valid nested sibling objects may reuse ordinary property names', () =>
  withReviewedFiles(async ({ root }) => {
    const report = await replayPrivateReviewedCaptureDirectory(root)
    assert.equal(report.acceptedSources, 6)
  }))

test('ambiguous evidence is refused by CLI without source details or stdout', () =>
  withReviewedFiles(async ({ root, manifest }) => {
    await manifestRaw(root, JSON.stringify(manifest).replace(
      '"permissionVerified":false', '"permissionVerified":true,"permissionVerified":false'))
    const runner = new URL('../scripts/retailer-private-reviewed-manifest-replay.mjs', import.meta.url).pathname
    const completed = spawnSync(process.execPath,
      ['--experimental-strip-types', runner, '--dir', root],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 16384 })
    assert.equal(completed.status, 2)
    assert.equal(completed.stdout, '')
    assert.match(completed.stderr, /^Private reviewed retailer capture replay refused\\s*$/)
    assert.equal(completed.stderr.includes(root), false)
  }))
