import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmod, lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { RETAILER_REVIEWED_FIXTURES, loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildPrivateReviewedManifest } from '../scripts/retailer-private-reviewed-manifest-builder.mjs'
import { loadPrivateReviewedCaptureBatch, replayPrivateReviewedCaptureDirectory } from '../scripts/retailer-private-reviewed-manifest-replay.mjs'
import { runPrivateRetailerPipeline } from '../scripts/retailer-private-offline-end-to-end.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

/**
 * Independent offline fault campaign against SIX actual reviewed M1 adapter
 * evidence shapes; no fabricated retailer prices, network calls, or release.
 * Every mutation is confined to newly-created 0700 temporary directories.
 */
const FIXTURES = await Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
  readFile(new URL('../fixtures/m1/' + name, import.meta.url))))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const reference = await loadReviewedRepositoryFixtures()
const totalObservations = reference.summary.observations
let scenarios = 0

async function staged(permutation = [0, 1, 2, 3, 4, 5]) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-six-shape-fault-'))
  for (let i = 0; i < 6; i++) {
    await writeFile(join(dir, 'capture-' + i + '.json'), FIXTURES[permutation[i]], {
      mode: 0o600, flag: 'wx',
    })
  }
  return dir
}
const clean = dir => rm(dir, { recursive: true, force: true })
const readManifest = async dir => JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
const writeManifest = (dir, data) =>
  writeFile(join(dir, 'manifest.json'), JSON.stringify(data) + '\n', { mode: 0o600 })
const requirePrivate = summary => {
  for (const key of ['productionEnabled', 'permissionVerified', 'publicSavingsClaimEligible',
    'livePricesAvailable']) assert.equal(summary[key], false, key)
  assert.equal(summary.externalRequests, 0)
  assert.equal(summary.sources, 6)
  assert.equal(summary.acceptedSources, 6)
  assert.equal(summary.sixShapeCoverageComplete, true)
  assert.equal(summary.observations, totalObservations)
  assert.ok(summary.products > 0)
  assert.ok(summary.captureEvents > 0)
}
const assertNoPrivateLabels = result => {
  const wire = JSON.stringify(result)
  assert.doesNotMatch(wire, /https?:\/\/|currentPriceCents|productName|sourceProductId|manifest\.json|capture-[0-9]\.json|\.sha256/i)
  for (const record of reference.results) {
    for (const product of record.observations) {
      assert.equal(wire.includes(product.name), false)
      assert.equal(wire.includes(product.provenance.url), false)
      assert.equal(wire.includes(product.provenance.sha256), false)
    }
  }
}
const rotate = (a, shift) => a.map((_, i) => a[(i + shift) % a.length])
// Deterministic seeded Fisher-Yates, no network or random flaky CI seeds.
function permutation(seed) {
  const list = [0, 1, 2, 3, 4, 5]
  let state = seed >>> 0
  for (let i = list.length - 1; i > 0; i--) {
    state = (1664525 * state + 1013904223) >>> 0
    const j = state % (i + 1)
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}
async function withPinned(action) {
  const dir = await staged()
  try {
    await buildPrivateReviewedManifest(dir)
    return await action(dir)
  } finally { await clean(dir) }
}
const corruption = [
  bytes => Buffer.concat([bytes, Buffer.from('\n')]),
  bytes => Buffer.concat([Buffer.from(' '), bytes]),
  bytes => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]),
  bytes => bytes.subarray(0, bytes.length - 1),
  bytes => Buffer.concat([bytes, Buffer.from([0x00])]),
  bytes => Buffer.concat([bytes, Buffer.from([0xff, 0xfe])]),
  bytes => Buffer.concat([bytes, Buffer.from(' ') , Buffer.from(' ')]),
]
const tamperManifest = [
  (m, i) => { m.sources[i].sha256 = 'a'.repeat(64) },
  (m, i) => { m.sources[i].key = m.sources[(i + 1) % 6].key },
  (m, i) => { m.sources[i].file = m.sources[(i + 1) % 6].file },
  (m, i) => { m.sources[i].file = '../secret.json' },
  (m, i) => { m.sources[i].file = 'manifest.json' },
  (m, i) => { m.sources[i].sha256 = m.sources[i].sha256.toUpperCase() },
  (m, i) => { m.sources[i].unexpectedProof = true },
]
const rootTamper = [
  m => { m.schemaVersion = 999 },
  m => { m.mode = 'production-retailer' },
  m => { m.productionEnabled = true },
  m => { m.permissionVerified = true },
  m => { m.publicSavingsClaimEligible = true },
  m => { m.unreviewedGrant = { claimed: true } },
  m => { m.sources = m.sources.slice(1) },
  m => { m.sources.push(m.sources[0]) },
  m => { m.sources = 'not-an-array' },
  m => { m.sources = null },
]

describe('QA: six-shape physical retailer evidence fail-closed fault campaign', () => {
  it('96 deterministic staged file permutations preserve archived six-adapter truth and private aggregate, never network', async () => {
    const originalFetch = globalThis.fetch
    let networkAttempts = 0
    globalThis.fetch = () => { networkAttempts++; throw new Error('NO EXTERNAL RETAIL HTTP') }
    const baseline = await withPinned(replayPrivateReviewedCaptureDirectory)
    try {
      for (let seed = 0; seed < 96; seed++) {
        const dir = await staged(permutation(seed))
        try {
          const created = await buildPrivateReviewedManifest(dir)
          assert.equal(created.filesPinned, 6)
          const output = await replayPrivateReviewedCaptureDirectory(dir)
          requirePrivate(output)
          assert.deepEqual(output, baseline, 'permutation seed ' + seed)
          assertNoPrivateLabels(output)
          scenarios++
        } finally { await clean(dir) }
      }
      assert.equal(networkAttempts, 0)
    } finally { globalThis.fetch = originalFetch }
  })

  it('42 real source SHA-byte corruptions after pin never become validated data, across all retailer types', async () => {
    for (let kind = 0; kind < 6; kind++) {
      for (const mutate of corruption) {
        await withPinned(async dir => {
          const path = join(dir, 'capture-' + kind + '.json')
          const before = await readFile(path)
          const manifest = await readManifest(dir)
          await writeFile(path, mutate(before), { mode: 0o600 })
          assert.equal(manifest.sources[kind].sha256, digest(before))
          await assert.rejects(replayPrivateReviewedCaptureDirectory(dir))
          await assert.rejects(loadPrivateReviewedCaptureBatch(dir))
          scenarios++
        })
      }
    }
  })

  it('42 manifest entry tamperings never launder unsupported sources, prices or file paths', async () => {
    for (let kind = 0; kind < 6; kind++) {
      for (const tamper of tamperManifest) {
        await withPinned(async dir => {
          const manifest = await readManifest(dir)
          tamper(manifest, kind)
          await writeManifest(dir, manifest)
          await assert.rejects(replayPrivateReviewedCaptureDirectory(dir))
          scenarios++
        })
      }
    }
  })

  it('10 dangerous root status/schema/array manipulations never elevate rights or public savings', async () => {
    for (const edit of rootTamper) {
      await withPinned(async dir => {
        const manifest = await readManifest(dir)
        edit(manifest)
        await writeManifest(dir, manifest)
        await assert.rejects(replayPrivateReviewedCaptureDirectory(dir))
        scenarios++
      })
    }
  })

  it('24 successful pinned manifest-order permutations preserve only historical private counts', async () => {
    for (let seed = 0; seed < 24; seed++) {
      await withPinned(async dir => {
        const before = await replayPrivateReviewedCaptureDirectory(dir)
        const manifest = await readManifest(dir)
        manifest.sources = rotate(manifest.sources, seed % 6)
        if (seed % 2) manifest.sources.reverse()
        await writeManifest(dir, manifest)
        const after = await replayPrivateReviewedCaptureDirectory(dir)
        assert.deepEqual(after, before)
        requirePrivate(after)
        assertNoPrivateLabels(after)
        scenarios++
      })
    }
  })

  it('18 file-access boundary failures across all six sources are denied despite valid SHA', async () => {
    for (let kind = 0; kind < 6; kind++) {
      await withPinned(async dir => {
        const path = join(dir, 'capture-' + kind + '.json')
        await chmod(path, 0o644)
        await assert.rejects(replayPrivateReviewedCaptureDirectory(dir))
        scenarios++
      })
      await withPinned(async dir => {
        const path = join(dir, 'capture-' + kind + '.json')
        await chmod(path, 0o666)
        await assert.rejects(replayPrivateReviewedCaptureDirectory(dir))
        scenarios++
      })
      await withPinned(async dir => {
        const path = join(dir, 'capture-' + kind + '.json')
        const sibling = join(dir, 'alias-' + kind)
        await symlink(path, sibling)
        const manifest = await readManifest(dir)
        manifest.sources[kind].file = 'alias-' + kind + '.json'
        await writeManifest(dir, manifest)
        await assert.rejects(replayPrivateReviewedCaptureDirectory(dir))
        scenarios++
      })
    }
  })

  it('real reviewed batch and catalog preserve all six SHA-pinned facts without authorizing source rights', async () => {
    await withPinned(async dir => {
      const batch = await loadPrivateReviewedCaptureBatch(dir)
      const catalog = buildUniversalRetailerCatalog(batch)
      assert.equal(catalog.status, 'private-review-only')
      assert.equal(catalog.productionEnabled, false)
      assert.equal(catalog.publicSavingsClaimEligible, false)
      assert.equal(batch.summary.acceptedSources, 6)
      assert.equal(batch.summary.permissionVerified, false)
      for (const product of catalog.products) {
        assert.equal(product.publishable, false)
        assert.equal(product.sourceRightsVerified, false)
        assert.equal(product.currentTrustedPriceCents, null)
      }
      scenarios++
    })
  })

  it('real one-command staged pipeline cannot overwrite a pinned manifest or expose its source evidence', async () => {
    const dir = await staged()
    try {
      const before = await readdir(dir)
      assert.equal(before.length, 6)
      const first = await runPrivateRetailerPipeline(dir)
      assert.equal(first.pinnedSources, 6)
      assert.equal(first.acceptedSources, 6)
      assert.equal(first.publicSavingsClaimEligible, false)
      assert.equal(first.productionEnabled, false)
      assert.equal(first.livePricesAvailable, false)
      assert.equal(first.externalRequests, 0)
      assertNoPrivateLabels(first)
      const manifestBefore = await readFile(join(dir, 'manifest.json'))
      await assert.rejects(runPrivateRetailerPipeline(dir))
      assert.deepEqual(await readFile(join(dir, 'manifest.json')), manifestBefore)
      for (let i = 0; i < 6; i++)
        assert.equal(digest(await readFile(join(dir, 'capture-' + i + '.json')), digest(FIXTURES[i]))
      scenarios++
    } finally { await clean(dir) }
  })

  it('resists archive mutation to invalid UTF8 before creating manifest, without leaving a partial manifest', async () => {
    for (let kind = 0; kind < 6; kind++) {
      const dir = await staged()
      try {
        await writeFile(join(dir, 'capture-' + kind + '.json'), Buffer.from([0xff, 0xfe]), { mode: 0o600 })
        await assert.rejects(buildPrivateReviewedManifest(dir))
        assert.equal((await readdir(dir)).includes('manifest.json'), false)
        scenarios++
      } finally { await clean(dir) }
    }
  })

  it('campaign covers at least 230 real source/manifest/ordering scenarios; no release assertion', () => {
    assert.ok(scenarios >= 230, 'actual scenarios=' + scenarios)
  })
})
