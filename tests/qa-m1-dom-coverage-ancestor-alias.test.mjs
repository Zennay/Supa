import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { inventoryDomCandidateReviews } from '../scripts/m1-dom-candidate-coverage.mjs'
import { reviewDomProbe } from '../scripts/m1-dom-candidate-review.mjs'
import { RESEARCH_SOURCES } from '../scripts/m1-multistore-research.mjs'

const source = RESEARCH_SOURCES[0]
const nowMs = Date.parse('2026-10-11T00:24:00.000Z')
const stamp = new Date(nowMs - 60_000).toISOString()
const stem = 'capture-' + (nowMs - 60_000) + '-99'
const privateText = 'PRIVATE-RETAIL-CONTENT-MUST-NOT-LEAK'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-coverage-alias-'))
  const privateRoot = join(root, 'canonical')
  const outputDir = join(privateRoot, 'reviews')
  const storeDir = join(outputDir, source.id)
  await mkdir(storeDir, { recursive: true, mode: 0o700 })
  const candidate = reviewDomProbe({
    version: 1, kind: 'rendered-dom-candidate-only',
    originHost: new URL(source.url).hostname, capturedAt: stamp,
    selectors: [{ role: 'product-name', selector: 'h1', count: 1,
      groundedInCurrentDom: true, semanticVerified: false }],
    actualClassCandidates: [],
  }, { sourceId: source.id, nowMs })
  await writeFile(join(storeDir, stem + '-candidate-review.json'), JSON.stringify({
    ...candidate, captureStem: stem, captureAuditStatus: 'manual-review',
  }), { mode: 0o600 })
  return { root, privateRoot, outputDir }
}

test('canonical private root still counts one offline human-review candidate', async () => {
  const f = await fixture()
  try {
    const result = await inventoryDomCandidateReviews({ outputDir: f.outputDir, nowMs })
    assert.equal(result.status, 'pending-human-review')
    assert.equal(result.totals.pendingHumanReview, 1)
    assert.equal(result.publicSavingsClaimEligible, false)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('ancestor symlink above existing private reviews must not be counted as canonical evidence', async () => {
  const f = await fixture()
  try {
    const alias = join(f.root, 'alias')
    await symlink(f.privateRoot, alias)
    const result = await inventoryDomCandidateReviews({ outputDir: join(alias, 'reviews'), nowMs })
    assert.equal(result.status, 'rejected')
    assert.equal(result.totals.pendingHumanReview, 0)
    assert.ok(result.totals.unexpected + result.totals.rejected > 0)
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE-RETAIL|h1|capture-\d+/)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('deep ancestor alias must reject before source review enumeration', async () => {
  const f = await fixture()
  try {
    const safe = join(f.root, 'real-private')
    await mkdir(safe, { mode: 0o700 })
    await symlink(f.privateRoot, join(safe, 'alias'))
    const result = await inventoryDomCandidateReviews({ outputDir: join(safe, 'alias', 'reviews'), nowMs })
    assert.equal(result.status, 'rejected')
    assert.equal(result.totals.pendingHumanReview, 0)
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE-RETAIL|h1|capture-\d+/)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('symlink ancestor leading to a missing review directory must be rejected instead of no-reviews', async () => {
  const f = await fixture()
  try {
    const alias = join(f.root, 'alias')
    await symlink(f.privateRoot, alias)
    const result = await inventoryDomCandidateReviews({
      outputDir: join(alias, 'missing', 'nested'), nowMs,
    })
    assert.equal(result.status, 'rejected')
    assert.equal(result.totals.pendingHumanReview, 0)
    assert.equal(result.publicSavingsClaimEligible, false)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})
