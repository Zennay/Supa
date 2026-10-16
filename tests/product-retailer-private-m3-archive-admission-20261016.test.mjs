import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  assessPrivateM3RetailerIngestion, main,
} from '../scripts/retailer-private-m3-ingestion-preflight.mjs'
import {
  RETAILER_REVIEWED_FIXTURES, loadReviewedRepositoryFixtures,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildPrivateReviewedManifest } from '../scripts/retailer-private-reviewed-manifest-builder.mjs'

const CLOCK = '2026-10-15T10:00:00.000Z'
const SCRIPT = fileURLToPath(new URL(
  '../scripts/retailer-private-m3-ingestion-preflight.mjs', import.meta.url))

async function prepareReviewedArchive(additionalSnapshots = 0) {
  const directory = await mkdtemp(join(tmpdir(), 'supa-private-preflight-'))
  try {
    for (let i = 0; i < RETAILER_REVIEWED_FIXTURES.length; i++) {
      const bytes = await readFile(new URL(
        '../fixtures/m1/' + RETAILER_REVIEWED_FIXTURES[i], import.meta.url))
      await writeFile(join(directory, 'capture-' + i + '.json'), bytes, {
        flag: 'wx', mode: 0o600,
      })
    }
    // Fictional, in-memory-derived additional reviewed events for contract
    // tests only. These are NOT new physical retailer captures or prices.
    for (let i = 0; i < additionalSnapshots; i++) {
      const fixture = RETAILER_REVIEWED_FIXTURES[i % 2 === 0 ? 1 : 2]
      const source = JSON.parse(await readFile(
        new URL('../fixtures/m1/' + fixture, import.meta.url), 'utf8'))
      source.source.id = source.source.id + '-test-event-' + i
      source.source.capturedAt = '2026-10-0' + (5 + i) + 'T18:53:02.645Z'
      await writeFile(join(directory, 'capture-' + (6 + i) + '.json'),
        JSON.stringify(source) + '\n', { flag: 'wx', mode: 0o600 })
    }
    await buildPrivateReviewedManifest(directory)
    return directory
  } catch (error) {
    await rm(directory, { force: true, recursive: true })
    throw error
  }
}

async function archiveSignature(directory) {
  const files = (await readdir(directory)).sort()
  const results = []
  for (const file of files) {
    const path = join(directory, file)
    const metadata = await stat(path, { bigint: true })
    results.push({
      name: file,
      digest: createHash('sha256').update(await readFile(path)).digest('hex'),
      size: metadata.size.toString(),
      mode: metadata.mode.toString(),
      inode: metadata.ino.toString(),
      nlink: metadata.nlink.toString(),
      mtime: metadata.mtimeNs.toString(),
    })
  }
  return results
}

test('operator SHA-pinned six-source archive produces same safe counts without modifying any evidence', async () => {
  const directory = await prepareReviewedArchive()
  try {
    const before = await archiveSignature(directory)
    const output = []
    const report = await main(['--dir', directory, '--at', CLOCK],
      line => output.push(line))
    const embedded = await main(['--at', CLOCK], () => {})
    assert.equal(report.inputMode, 'operator-private-manifest')
    assert.equal(report.operatorSuppliedPrivateSources, true)
    assert.equal(report.historicalReviewedOnly, true)
    assert.equal(report.releaseDecision, 'hold')
    assert.equal(report.productionEnabled, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.liveRequests, 0)
    for (const key of ['acceptedSourceShapes', 'acceptedHistoricalObservations',
      'normalizedPrivateProducts', 'archivedOfferRows',
      'corroboratedHistoricalOfferBaselines']) {
      assert.equal(report[key], embedded[key], key)
    }
    assert.equal(report.perSourceShape.length, 6)
    assert.deepEqual(JSON.parse(output[0]), report)
    assert.doesNotMatch(output[0], /https?:\/\/|sourceProductId|sha256|snapshotSha256|currentPriceCents|capture-[0-9]\.json/i)
    assert.equal(output[0].includes(directory), false)
    assert.deepEqual(await archiveSignature(directory), before)
    // Exercise the actual operator binary, not merely its exported function.
    const executable = spawnSync(process.execPath, [
      '--experimental-strip-types', SCRIPT, '--dir', directory, '--at', CLOCK,
    ], { encoding: 'utf8', timeout: 30_000 })
    assert.equal(executable.status, 0)
    assert.equal(executable.stderr, '')
    assert.deepEqual(JSON.parse(executable.stdout), report)
    assert.equal(executable.stdout.includes(directory), false)
    // A second read is idempotent: this path never recreates manifest.json.
    await main(['--dir', directory, '--at', CLOCK], () => {})
    assert.deepEqual(await archiveSignature(directory), before)
  } finally { await rm(directory, { force: true, recursive: true }) }
})

test('multi-capture private archive retains all reviewed events but selects only newest per shape for offer audit', async () => {
  const directory = await prepareReviewedArchive(2)
  try {
    const before = await archiveSignature(directory)
    const report = await main(['--dir', directory, '--at', CLOCK], () => {})
    assert.equal(report.historicalSourceEvents, 8)
    assert.equal(report.historicalStockUnknownObservations +
      report.historicalStockUnavailableObservations +
      report.historicalStockAvailableObservations,
      report.acceptedHistoricalObservations)
    assert.equal(report.currentStockCoverageVerified, false)
    assert.ok(report.perSourceShape.every(row =>
      row.unknownHistoricalAvailability +
        row.unavailableHistoricalObservations +
        row.availableHistoricalObservations === row.archivedObservations))
    assert.equal(report.perSourceShape.reduce((n, row) =>
      n + row.unknownHistoricalAvailability, 0),
    report.historicalStockUnknownObservations)
    assert.equal(report.selectedSourceEventsForOfferReview, 6)
    assert.equal(report.sourceEventsOutsideOfferReview, 2)
    assert.equal(report.offerReviewSelectionPolicy,
      'latest-physical-capture-per-retailer-kind')
    assert.equal(report.allHistoricalOfferRows,
      report.archivedOfferRows + report.olderHistoricalOfferRowsNotCompared)
    assert.ok(report.olderHistoricalOfferRowsNotCompared > 0)
    assert.equal(report.perSourceShape.find(x =>
      x.retailer === 'plus' && x.kind === 'catalog').acceptedHistoricalSources, 2)
    assert.equal(report.perSourceShape.find(x =>
      x.retailer === 'plus' && x.kind === 'offers').acceptedHistoricalSources, 2)
    assert.equal(report.perSourceShape.find(x =>
      x.retailer === 'plus' && x.kind === 'offers').latestArchivedCapturedAt,
      '2026-10-06T18:53:02.645Z')
    assert.equal(report.acceptedSourceShapes, 6)
    assert.equal(report.completeHistoricalSourceShapeCoverage, true)
    assert.equal(report.releaseDecision, 'hold')
    assert.ok(report.operatorActions.includes(
      'review-additional-archived-source-events-outside-offer-comparison'))
    const child = spawnSync(process.execPath, [
      '--experimental-strip-types', SCRIPT, '--dir', directory, '--at', CLOCK,
    ], { encoding: 'utf8', timeout: 30_000 })
    assert.equal(child.status, 0)
    assert.equal(child.stderr, '')
    assert.deepEqual(JSON.parse(child.stdout), report)
    assert.equal(child.stdout.includes(directory), false)
    assert.doesNotMatch(child.stdout,
      /https?:\/\/|sourceProductId|sha256|currentPriceCents|capture-[0-9]\.json/i)
    assert.deepEqual(await archiveSignature(directory), before)
  } finally { await rm(directory, { force: true, recursive: true }) }
})

test('tampered source is refused before stdout; source bytes and metadata stay untouched by preflight', async () => {
  const directory = await prepareReviewedArchive()
  try {
    const path = join(directory, 'capture-0.json')
    await writeFile(path, (await readFile(path, 'utf8')) + ' ', { flag: 'w' })
    const before = await archiveSignature(directory)
    let emitted = false
    await assert.rejects(main(['--dir', directory, '--at', CLOCK], () => {
      emitted = true
    }), /Private M3 integrated retailer preflight refused/)
    assert.equal(emitted, false)
    const child = spawnSync(process.execPath, [
      '--experimental-strip-types', SCRIPT, '--dir', directory, '--at', CLOCK,
    ], { encoding: 'utf8', timeout: 30_000 })
    assert.equal(child.status, 2)
    assert.equal(child.stdout, '')
    assert.equal(child.stderr.trim(), 'Private M3 integrated retailer preflight refused')
    assert.deepEqual(await archiveSignature(directory), before)
  } finally { await rm(directory, { force: true, recursive: true }) }
})

test('private operator CLI rejects inherited slots, own getters, proxies and unsupported flags before filesystem reads', async () => {
  let calls = 0
  const argv = ['--dir', '/not/used']
  Object.defineProperty(argv, '1', { get() { calls++; return '/not/used' } })
  await assert.rejects(main(argv), /preflight refused/)
  const inherited = new Array(2)
  // Sparse positional slots must not read inherited values.
  await assert.rejects(main(inherited), /preflight refused/)
  const proxy = new Proxy(['--dir', '/not/used'], {
    get() { calls++; throw new Error('must not run') },
    getOwnPropertyDescriptor() { calls++; throw new Error('must not run') },
  })
  await assert.rejects(main(proxy), /preflight refused/)
  assert.equal(calls, 0)
  for (const args of [
    ['--dir'], ['--dir', ''], ['--dir', '--at'], ['--at', CLOCK, '--dir', '/x'],
    ['--dir', '/x', '--at', CLOCK, '--extra'], ['--directory', '/x'],
  ]) {
    await assert.rejects(main(args), /preflight refused/)
  }
})

test('in-process preflight refuses options getter/proxy/inheritance without executing traps', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const rights = JSON.parse(await readFile(new URL(
    '../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
  let calls = 0
  const inherited = Object.create({
    get referenceTime() { calls++; throw Error('should never execute') },
  })
  const own = {}
  Object.defineProperty(own, 'referenceTime', {
    get() { calls++; throw Error('should never execute') },
  })
  const proxied = new Proxy({}, {
    get() { calls++; throw Error('should never execute') },
    ownKeys() { calls++; throw Error('should never execute') },
    getPrototypeOf() { calls++; throw Error('should never execute') },
  })
  for (const options of [inherited, own, proxied, {unexpected: 'field'}]) {
    assert.throws(() => assessPrivateM3RetailerIngestion(rights, batch, options),
      /preflight refused/)
  }
  assert.equal(calls, 0)
  const control = assessPrivateM3RetailerIngestion(rights, batch,
    { referenceTime: CLOCK })
  assert.equal(control.releaseDecision, 'hold')
})
