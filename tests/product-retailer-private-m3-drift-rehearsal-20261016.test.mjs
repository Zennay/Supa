import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { buildPrivateReviewedManifest } from '../scripts/retailer-private-reviewed-manifest-builder.mjs'
import { RETAILER_REVIEWED_FIXTURES, loadReviewedRepositoryFixtures } from
  '../scripts/retailer-reviewed-ingest-engine.mjs'
import { rehearsePrivateM3RetailerDrift, main } from
  '../scripts/retailer-private-m3-capture-drift-rehearsal.mjs'

const AT = '2026-10-15T10:00:00.000Z'
const SCRIPT = fileURLToPath(new URL(
  '../scripts/retailer-private-m3-capture-drift-rehearsal.mjs', import.meta.url))
async function rights() {
  return JSON.parse(await readFile(new URL(
    '../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
}

async function createArchive() {
  const dir = await mkdtemp(join(tmpdir(), 'supa-drift-rehearsal-'))
  try {
    for (let i = 0; i < RETAILER_REVIEWED_FIXTURES.length; i++) {
      const bytes = await readFile(new URL(
        '../fixtures/m1/' + RETAILER_REVIEWED_FIXTURES[i], import.meta.url))
      await writeFile(join(dir, 'capture-' + i + '.json'), bytes, {
        flag: 'wx', mode: 0o600,
      })
    }
    await buildPrivateReviewedManifest(dir)
    return dir
  } catch (e) {
    await rm(dir, { recursive: true, force: true })
    throw e
  }
}
async function fingerprint(dir) {
  const names = (await readdir(dir)).sort()
  return Promise.all(names.map(async name => {
    const path = join(dir, name)
    const s = await stat(path, { bigint: true })
    return {
      name,
      sha: createHash('sha256').update(await readFile(path)).digest('hex'),
      inode: s.ino.toString(), size: s.size.toString(),
      mode: s.mode.toString(), nlink: s.nlink.toString(),
      mtime: s.mtimeNs.toString(),
    }
  }))
}

test('real two-directory SHA-pinned replay is read-only, no fabricated live changes', async () => {
  const before = await createArchive()
  const after = await createArchive()
  try {
    const first = await fingerprint(before)
    const second = await fingerprint(after)
    const writes = []
    const report = await main(['--before-dir', before,
      '--after-dir', after, '--at', AT], line => writes.push(line))
    assert.equal(writes.length, 1)
    assert.deepEqual(JSON.parse(writes[0]), report)
    assert.equal(report.mode, 'private-m3-offline-capture-drift-rehearsal')
    assert.equal(report.historicalSourceShapes, 6)
    assert.equal(report.beforeArchivedSourceEvents, 6)
    assert.equal(report.afterArchivedSourceEvents, 6)
    assert.equal(report.archivedChangedFactFields, 0)
    assert.equal(report.alertShapeCount, 0)
    assert.deepEqual(report.operatorAlertKinds, [])
    assert.equal(report.manualSourceReviewRequired, false)
    assert.equal(report.historicalReviewRequired, true)
    assert.equal(report.releaseDecision, 'hold')
    assert.equal(report.approvalForNewCapture, false)
    assert.equal(report.liveRequests, 0)
    assert.equal(report.productionEnabled, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.currentPriceVerified, false)
    assert.equal(report.currentAvailabilityVerified, false)
    assert.equal(report.perShape.length, 6)
    assert.ok(report.perShape.every(row =>
      row.previouslyArchivedAt === row.currentlyArchivedAt &&
      row.historicalChangedFactFields === 0))
    assert.doesNotMatch(writes[0],
      /https?:\/\/|sourceProductId|sha256|currentPriceCents|retailerProductId|capture-[0-9]\.json/i)
    assert.equal(writes[0].includes(before), false)
    assert.equal(writes[0].includes(after), false)
    const processResult = spawnSync(process.execPath,
      ['--experimental-strip-types', SCRIPT, '--before-dir', before,
        '--after-dir', after, '--at', AT], {
        encoding: 'utf8', timeout: 30_000,
      })
    assert.equal(processResult.status, 0, processResult.stderr)
    assert.deepEqual(JSON.parse(processResult.stdout), report)
    assert.equal(processResult.stderr, '')
    assert.deepEqual(await fingerprint(before), first)
    assert.deepEqual(await fingerprint(after), second)
  } finally {
    await rm(before, { recursive: true, force: true })
    await rm(after, { recursive: true, force: true })
  }
})

test('synthetic distinct later capture changes show exactly archival review-only signals', async () => {
  const oldBatch = structuredClone(await loadReviewedRepositoryFixtures())
  const currentBatch = structuredClone(oldBatch)
  const shape = currentBatch.results[0]
  const oldWhen = shape.observations[0].provenance.capturedAt
  const oldNs = Date.parse(oldWhen)
  const newWhen = new Date(oldNs + 86_400_000).toISOString()
  // Test mutation only; this is NEVER a real capture or observed price.
  for (const observation of shape.observations) {
    observation.provenance.capturedAt = newWhen
    observation.provenance.sha256 = 'b'.repeat(64)
  }
  shape.observations[0].availability =
    shape.observations[0].availability === 'unavailable' ? 'unknown' : 'unavailable'
  const report = rehearsePrivateM3RetailerDrift(
    await rights(), oldBatch, currentBatch, { referenceTime: AT })
  assert.equal(report.releaseDecision, 'hold')
  assert.equal(report.currentAvailabilityVerified, false)
  assert.equal(report.historicalSourceShapes, 6)
  assert.ok(report.alertShapeCount > 0)
  assert.ok(report.archivedChangedFactFields > 0)
  assert.ok(report.operatorAlertKinds.includes('review-archived-product-fact-changes'))
  assert.ok(report.perShape.some(row =>
    row.historicalChangedFactFields > 0 && row.reviewSignals.length > 0))
  assert.equal(report.liveRequests, 0)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.ok(!JSON.stringify(report).includes('b'.repeat(64)))
})

test('an archived source clock regression is refused even when product IDs are disjoint', async () => {
  const oldBatch = structuredClone(await loadReviewedRepositoryFixtures())
  const currentBatch = structuredClone(oldBatch)
  const shape = currentBatch.results[0]
  const oldWhen = shape.observations[0].provenance.capturedAt
  const newWhen = new Date(Date.parse(oldWhen) - 86_400_000).toISOString()
  for (const observation of shape.observations) {
    observation.sourceProductId = 'counterfactual-' + observation.sourceProductId
    observation.provenance.capturedAt = newWhen
    observation.provenance.sha256 = 'a'.repeat(64)
  }
  const gate = await rights()
  assert.throws(() => rehearsePrivateM3RetailerDrift(
    gate, oldBatch, currentBatch, { referenceTime: AT }),
  /refused/)
})

// No invocation may read inherited properties, accessors or proxy getters.
test('same-clock SHA change with all disjoint SKU identities cannot masquerade as a new catalog', async () => {
  const older = structuredClone(await loadReviewedRepositoryFixtures())
  const candidate = structuredClone(older)
  for (const ob of candidate.results[0].observations) {
    ob.sourceProductId = 'counterfactual-' + ob.sourceProductId
    ob.provenance.sha256 = 'a'.repeat(64)
    // Same physical capture time + different SHA is impossible continuity.
  }
  const gate = await rights()
  assert.throws(() => rehearsePrivateM3RetailerDrift(
    gate, older, candidate, { referenceTime: AT }), /refused/)
})

test('operator CLI rejects invalid/sparse/accessor/proxy argv before reading any evidence', async () => {
  const rejects = [
    [], ['--before-dir', '/a'], ['--after-dir', '/b'],
    ['--before-dir', '/a', '--after-dir', '/a'],
    ['--after-dir', '/a', '--before-dir', '/b'],
    ['--before-dir', '/a', '--after-dir', '/b', '--at', 'today'],
    ['--before-dir', '/a', '--after-dir', '/b', '--extra', AT],
  ]
  for (const args of rejects) {
    await assert.rejects(main(args), /Private M3 retailer drift rehearsal refused/)
  }
  let accesses = 0
  const getter = ['--before-dir', '/x', '--after-dir', '/y']
  Object.defineProperty(getter, 1, {
    get() { accesses++; throw new Error('caller trap should not run') },
  })
  await assert.rejects(main(getter), /Private M3 retailer drift rehearsal refused/)
  const proxy = new Proxy(['--before-dir', '/a', '--after-dir', '/b'], {
    get() { accesses++; throw new Error('caller trap should not run') },
    getOwnPropertyDescriptor() { accesses++; throw new Error('caller trap should not run') },
  })
  await assert.rejects(main(proxy), /Private M3 retailer drift rehearsal refused/)
  assert.equal(accesses, 0)
  await assert.rejects(main(new Array(4)), /Private M3 retailer drift rehearsal refused/)
})

test('direct options reject Proxy, inherited values and own getters without executing them', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const permissionGate = await rights()
  let accesses = 0
  const getter = {}
  Object.defineProperty(getter, 'referenceTime', {
    get() { accesses++; throw Error('must not invoke') },
  })
  const inherited = Object.create({ referenceTime: AT })
  const proxied = new Proxy({}, {
    getPrototypeOf() { accesses++; throw Error('must not invoke') },
    ownKeys() { accesses++; throw Error('must not invoke') },
  })
  for (const opts of [getter, inherited, proxied, { unexpected: AT }]) {
    assert.throws(() => rehearsePrivateM3RetailerDrift(
      permissionGate, batch, batch, opts), /refused/)
  }
  assert.equal(accesses, 0)
})

test('tampered actual manifest source refuses without stdout, pathname or file modifications', async () => {
  const before = await createArchive()
  const after = await createArchive()
  try {
    const path = join(after, 'capture-0.json')
    await writeFile(path, (await readFile(path, 'utf8')) + ' ', { flag: 'w' })
    const oldSignature = await fingerprint(before)
    const newSignature = await fingerprint(after)
    let emitted = false
    await assert.rejects(main(['--before-dir', before,
      '--after-dir', after, '--at', AT], () => { emitted = true }),
    /Private M3 retailer drift rehearsal refused/)
    assert.equal(emitted, false)
    const child = spawnSync(process.execPath,
      ['--experimental-strip-types', SCRIPT,
        '--before-dir', before, '--after-dir', after, '--at', AT],
      { encoding: 'utf8', timeout: 30_000 })
    assert.equal(child.status, 2)
    assert.equal(child.stdout, '')
    assert.equal(child.stderr.trim(), 'Private M3 retailer drift rehearsal refused')
    assert.deepEqual(await fingerprint(before), oldSignature)
    assert.deepEqual(await fingerprint(after), newSignature)
  } finally {
    await rm(before, { recursive: true, force: true })
    await rm(after, { recursive: true, force: true })
  }
})
