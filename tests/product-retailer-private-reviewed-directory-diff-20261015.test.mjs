import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, chmod, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { RETAILER_REVIEWED_FIXTURES } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { compareReviewedDirectories, main } from '../scripts/retailer-private-reviewed-directory-diff.mjs'
import { replayPrivateReviewedCaptureDirectory,
  loadPrivateReviewedCaptureBatch } from '../scripts/retailer-private-reviewed-manifest-replay.mjs'

// Every case is strictly offline and uses the six previously reviewed
// historical repository fixtures, not real current prices or grants.
const at = '2026-10-15T21:00:00.000Z'
async function sandbox() {
  const directory = await mkdtemp(join(tmpdir(), 'supa-private-compare-'))
  const manifest = {
    schemaVersion: 1, mode: 'private-reviewed-retailer-batch',
    productionEnabled: false, permissionVerified: false,
    publicSavingsClaimEligible: false, sources: [],
  }
  for (const file of RETAILER_REVIEWED_FIXTURES) {
    const bytes = await readFile(new URL('../fixtures/m1/' + file, import.meta.url))
    const record = JSON.parse(bytes.toString('utf8'))
    const name = 'capture-' + manifest.sources.length + '.json'
    await writeFile(join(directory, name), bytes, { mode: 0o600, flag: 'wx' })
    manifest.sources.push({
      file: name, sha256: createHash('sha256').update(bytes).digest('hex'),
      key: record.source.supermarket + ':' + record.source.kind,
    })
  }
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest),
    { mode: 0o600, flag: 'wx' })
  return { directory, manifest }
}
async function twoSandbox() {
  const first = await sandbox()
  try { return [first, await sandbox()] }
  catch (err) { await rm(first.directory, { recursive: true, force: true }); throw err }
}
async function clean(pair) {
  await Promise.all(pair.map(p => rm(p.directory, { recursive: true, force: true })))
}

test('two different private SHA-pinned historical directories compare all six shapes without false prices', async () => {
  const pair = await twoSandbox()
  try {
    const result = await compareReviewedDirectories(pair[0].directory, pair[1].directory, { referenceTime: at })
    assert.equal(result.mode, 'private-historical-retailer-fact-change-review')
    assert.equal(result.totals.unchanged, result.comparedProducts)
    assert.ok(result.comparedProducts > 0)
    assert.equal(result.totals.priceChanged, 0)
    assert.equal(Object.keys(result.perShape).length, 6)
    assert.equal(result.publicSavingsClaimEligible, false)
    assert.equal(result.livePricesAvailable, false)
    assert.equal(result.externalRequests, 0)
    assert.equal(JSON.stringify(result).includes('www.plus.nl'), false)
    assert.equal(JSON.stringify(result).includes('halfvolle'), false)
  } finally { await clean(pair) }
})

test('original reviewed manifest aggregate contract remains unchanged after private in-memory extraction', async () => {
  const first = await sandbox()
  try {
    const [aggregate, batch] = await Promise.all([
      replayPrivateReviewedCaptureDirectory(first.directory, { referenceTime: at }),
      loadPrivateReviewedCaptureBatch(first.directory, { referenceTime: at }),
    ])
    assert.equal(aggregate.acceptedSources, batch.summary.acceptedSources)
    assert.equal(aggregate.sixShapeCoverageComplete, true)
    assert.equal(aggregate.permissionVerified, false)
    assert.equal(aggregate.publicSavingsClaimEligible, false)
    assert.equal(aggregate.externalRequests, 0)
  } finally { await clean([first]) }
})

test('CLI supports exactly two private directory args and optional explicit clock without revealing provenance', async () => {
  const pair = await twoSandbox()
  try {
    let printed = ''
    const result = await main([
      '--before-dir', pair[0].directory, '--after-dir', pair[1].directory, '--at', at,
    ], value => { printed += value })
    assert.deepEqual(JSON.parse(printed), result)
    assert.equal(result.totals.priceChanged, 0)
    assert.equal(printed.includes('capture-'), false)
    assert.equal(printed.includes('www.plus.nl'), false)
    await assert.rejects(main(['--before-dir', pair[0].directory]),
      /Private retailer reviewed directory diff refused/u)
    await assert.rejects(main([
      '--before-dir', pair[0].directory, '--after-dir', pair[0].directory,
    ]), /Private retailer reviewed directory diff refused/u)
    await assert.rejects(main([
      '--before-dir', pair[0].directory, '--after-dir', pair[1].directory, '--at', 'invalid',
    ]))
    await assert.rejects(main([
      '--before-dir', pair[0].directory, '--after-dir', pair[1].directory, '--publish',
    ]), /Private retailer reviewed directory diff refused/u)
  } finally { await clean(pair) }
})

test('tampering one authenticated capture or falsifying a manifest flag refuses both before comparison', async () => {
  const pair = await twoSandbox()
  try {
    await writeFile(join(pair[1].directory, 'capture-0.json'), '{"invalid":true}\n',
      { mode: 0o600 })
    await assert.rejects(compareReviewedDirectories(pair[0].directory, pair[1].directory,
      { referenceTime: at }), /refused/u)
    pair[0].manifest.productionEnabled = true
    await writeFile(join(pair[0].directory, 'manifest.json'), JSON.stringify(pair[0].manifest),
      { mode: 0o600 })
    await assert.rejects(compareReviewedDirectories(pair[0].directory, pair[1].directory,
      { referenceTime: at }), /refused/u)
  } finally { await clean(pair) }
})

test('world-readable evidence and symlink parent are refused; no hidden bypass', async () => {
  const pair = await twoSandbox()
  const aliasParent = await mkdtemp(join(tmpdir(), 'supa-private-alias-'))
  try {
    await chmod(join(pair[0].directory, 'capture-0.json'), 0o644)
    await assert.rejects(compareReviewedDirectories(pair[0].directory, pair[1].directory,
      { referenceTime: at }), /refused/u)
    await chmod(join(pair[0].directory, 'capture-0.json'), 0o600)
    const alias = join(aliasParent, 'alias')
    await symlink(pair[0].directory, alias)
    await assert.rejects(compareReviewedDirectories(alias, pair[1].directory,
      { referenceTime: at }), /refused/u)
  } finally {
    await clean(pair)
    await rm(aliasParent, { recursive: true, force: true })
  }
})

test('executable command emits only fixed privacy-safe stderr and no stdout when directory is invalid', () => {
  const marker = 'secret-private-capture-folder-5941'
  const result = spawnSync(process.execPath, [
    '--experimental-strip-types',
    new URL('../scripts/retailer-private-reviewed-directory-diff.mjs', import.meta.url).pathname,
    '--before-dir', marker, '--after-dir', marker + '-later',
  ], { encoding: 'utf8', timeout: 15_000 })
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr.includes(marker), false)
  assert.match(result.stderr, /Private retailer reviewed directory diff refused/u)
})
