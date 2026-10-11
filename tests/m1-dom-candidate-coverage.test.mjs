import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { inventoryDomCandidateReviews, main } from '../scripts/m1-dom-candidate-coverage.mjs'
import { reviewDomProbe } from '../scripts/m1-dom-candidate-review.mjs'
import { RESEARCH_SOURCES } from '../scripts/m1-multistore-research.mjs'

const nowMs = Date.parse('2026-10-11T00:10:00.000Z')
const stamp = new Date(nowMs - 60_000).toISOString()

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'supa-dom-candidate-coverage-'))
  const outputDir = join(root, 'reviews')
  await mkdir(outputDir, { mode: 0o700 })
  return { root, outputDir }
}

function candidate(source, observedAt = stamp) {
  const report = {
    version: 1, kind: 'rendered-dom-candidate-only',
    originHost: new URL(source.url).hostname,
    capturedAt: observedAt,
    selectors: [{ role: 'product-name', selector: 'h1', count: 1,
      groundedInCurrentDom: true, semanticVerified: false }],
    actualClassCandidates: [],
  }
  return { ...reviewDomProbe(report, { sourceId: source.id, nowMs: Math.max(nowMs, Date.parse(observedAt)) }),
    captureStem: 'capture-' + (nowMs - 60_000) + '-42',
    captureAuditStatus: 'manual-review' }
}

async function saveReview(outputDir, source, payload, basename = 'capture-' + (nowMs - 60_000) + '-42-candidate-review.json') {
  const dir = join(outputDir, source.id)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFile(join(dir, basename), JSON.stringify(payload), { mode: 0o600 })
}

test('empty private root reports no reviews without network requests', async () => {
  const f = await fixture()
  try {
    const missing = await inventoryDomCandidateReviews({ outputDir: join(f.root, 'absent'), nowMs })
    assert.equal(missing.status, 'no-reviews')
    assert.equal(missing.totals.pendingHumanReview, 0)
    assert.equal(missing.sources.length, 5)
    assert.equal(missing.publicSavingsClaimEligible, false)
    const empty = await inventoryDomCandidateReviews({ outputDir: f.outputDir, nowMs })
    assert.equal(empty.status, 'no-reviews')
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('five registered supermarket source IDs count only pending human DOM review', async () => {
  const f = await fixture()
  try {
    for (const source of RESEARCH_SOURCES) await saveReview(f.outputDir, source, candidate(source))
    const result = await inventoryDomCandidateReviews({ outputDir: f.outputDir, nowMs })
    assert.equal(result.status, 'pending-human-review')
    assert.equal(result.totals.pendingHumanReview, 5)
    assert.equal(result.totals.rejected, 0)
    assert.equal(result.totals.unexpected, 0)
    assert.equal(result.totals.stale, 0)
    assert.equal(result.sources.filter(s => s.pendingHumanReview === 1).length, 5)
    assert.equal(result.semanticVerified, false)
    assert.equal(result.retailerPermissionVerified, false)
    assert.equal(result.livePriceVerified, false)
    assert.doesNotMatch(JSON.stringify(result), /capture-\d|price-main|www\.dirk|\.html/)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('expired DOM observation is stale, not accepted as current or price verified', async () => {
  const f = await fixture()
  try {
    const oldStamp = new Date(nowMs - 24 * 60 * 60 * 1000 - 1).toISOString()
    const source = RESEARCH_SOURCES[0]
    await saveReview(f.outputDir, source, candidate(source, oldStamp))
    const result = await inventoryDomCandidateReviews({ outputDir: f.outputDir, nowMs })
    assert.equal(result.status, 'stale')
    assert.equal(result.totals.stale, 1)
    assert.equal(result.totals.pendingHumanReview, 0)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('tampered semantic flags, future timestamps and malformed JSON are rejected', async () => {
  const source = RESEARCH_SOURCES[0]
  for (const mode of ['semantic', 'retailer', 'future', 'source', 'broken']) {
    const f = await fixture()
    try {
      const payload = candidate(source)
      if (mode === 'semantic') payload.semanticVerified = true
      if (mode === 'retailer') payload.retailerPermissionVerified = true
      if (mode === 'future') payload.observedAt = new Date(nowMs + 1).toISOString()
      if (mode === 'source') payload.sourceId = 'other'
      await saveReview(f.outputDir, source, payload)
      if (mode === 'broken') {
        await writeFile(join(f.outputDir, source.id, 'capture-' + (nowMs - 60_000) + '-42-candidate-review.json'), '{')
      }
      const result = await inventoryDomCandidateReviews({ outputDir: f.outputDir, nowMs })
      assert.equal(result.status, 'rejected', mode)
      assert.equal(result.totals.rejected, 1, mode)
      assert.equal(result.totals.pendingHumanReview, 0, mode)
    } finally { await rm(f.root, { recursive: true, force: true }) }
  }
})

test('unexpected roots, files, symlinks and unsupported stems fail closed', async () => {
  const source = RESEARCH_SOURCES[0]
  const f = await fixture()
  try {
    await saveReview(f.outputDir, source, candidate(source))
    await mkdir(join(f.outputDir, 'unknown-store'))
    await writeFile(join(f.outputDir, source.id, 'visible-private-page.html'), 'DO NOT EXPORT')
    const result = await inventoryDomCandidateReviews({ outputDir: f.outputDir, nowMs })
    assert.equal(result.status, 'rejected')
    assert.equal(result.totals.unexpected, 2)
    assert.doesNotMatch(JSON.stringify(result), /DO NOT EXPORT|visible-private-page/)
    const linked = join(f.root, 'linked')
    await symlink(f.outputDir, linked)
    const symlinkResult = await inventoryDomCandidateReviews({ outputDir: linked, nowMs })
    assert.equal(symlinkResult.status, 'rejected')
    assert.equal(symlinkResult.totals.unexpected, 1)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('oversized source enumeration fails without parsing attacker files', async () => {
  const source = RESEARCH_SOURCES[0]
  const f = await fixture()
  try {
    const dir = join(f.outputDir, source.id)
    await mkdir(dir)
    for (let i = 0; i < 501; i++) await writeFile(join(dir, 'junk-' + i), 'not private')
    const result = await inventoryDomCandidateReviews({ outputDir: f.outputDir, nowMs })
    assert.equal(result.status, 'rejected')
    assert.equal(result.totals.unexpected, 501)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('coverage CLI requires exact safe switch', async () => {
  await assert.rejects(main(['--prices']), /usage/)
})
