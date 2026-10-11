import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { inventoryDomCandidateReviews } from '../scripts/m1-dom-candidate-coverage.mjs'
import { reviewDomProbe } from '../scripts/m1-dom-candidate-review.mjs'
import { RESEARCH_SOURCES } from '../scripts/m1-multistore-research.mjs'

// Independent integrity test: the inventory must revalidate on-disk records,
// not trust that another process only ever saved sanitized review objects.
const nowMs = Date.parse('2026-10-11T00:20:00.000Z')
const observedAt = new Date(nowMs - 60_000).toISOString()
const stem = 'capture-' + (nowMs - 60_000) + '-77'
const source = RESEARCH_SOURCES[0]
const secret = 'PRIVATE-SUPERMARKET-PRICE-NEVER-EMIT'

function validReview() {
  const result = reviewDomProbe({
    version: 1,
    kind: 'rendered-dom-candidate-only',
    originHost: new URL(source.url).hostname,
    capturedAt: observedAt,
    selectors: [{ role: 'product-name', selector: 'h1', count: 1,
      groundedInCurrentDom: true, semanticVerified: false }],
    actualClassCandidates: [{ selector: 'span.price-main',
      observedNodes: 2, semanticVerified: false }],
  }, { sourceId: source.id, nowMs })
  return { ...result, captureStem: stem, captureAuditStatus: 'manual-review' }
}

async function classifyReview(payload) {
  const root = await mkdtemp(join(tmpdir(), 'supa-m1-private-record-'))
  const outputDir = join(root, 'reviews')
  const privateDir = join(outputDir, source.id)
  try {
    await mkdir(privateDir, { mode: 0o700, recursive: true })
    await writeFile(join(privateDir, stem + '-candidate-review.json'),
      JSON.stringify(payload), { mode: 0o600 })
    return await inventoryDomCandidateReviews({ outputDir, nowMs })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('untampered sanitized DOM candidate remains pending manual review, never savings proof', async () => {
  const result = await classifyReview(validReview())
  assert.equal(result.status, 'pending-human-review')
  assert.equal(result.totals.pendingHumanReview, 1)
  assert.equal(result.semanticVerified, false)
  assert.equal(result.retailerPermissionVerified, false)
  assert.equal(result.publicSavingsClaimEligible, false)
})

test('empty selector candidates remain an honest manual-review input', async () => {
  const candidate = validReview()
  candidate.selectors = []
  candidate.actualClassCandidates = []
  const result = await classifyReview(candidate)
  assert.equal(result.status, 'pending-human-review')
  assert.equal(result.publicSavingsClaimEligible, false)
})

test('private review inventory rejects altered static selector records, not merely lengths', async () => {
  const cases = {
    'null row': v => { v.selectors = [null] },
    'string row': v => { v.selectors = ['h1'] },
    'invalid role': v => { v.selectors[0].role = 'price' },
    'unknown selector': v => { v.selectors[0].selector = '#checkout' },
    'zero count': v => { v.selectors[0].count = 0 },
    'noninteger count': v => { v.selectors[0].count = 1.5 },
    'oversized count': v => { v.selectors[0].count = 501 },
    'forged verified': v => { v.selectors[0].semanticVerified = true },
    'missing verified': v => { delete v.selectors[0].semanticVerified },
    'extra raw price': v => { v.selectors[0].privatePrice = secret },
    'duplicate': v => { v.selectors.push({ ...v.selectors[0] }) },
  }
  for (const [name, tamper] of Object.entries(cases)) {
    const candidate = validReview()
    tamper(candidate)
    const result = await classifyReview(candidate)
    assert.equal(result.status, 'rejected', name)
    assert.equal(result.totals.rejected, 1, name)
    assert.equal(result.totals.pendingHumanReview, 0, name)
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE-SUPERMARKET|#checkout|privatePrice/, name)
  }
})

test('private inventory refuses tampered CSS class candidates and their nested data', async () => {
  const cases = {
    'null class row': v => { v.actualClassCandidates = [null] },
    'unapproved selector': v => { v.actualClassCandidates[0].selector = 'a[href^="javascript:"]' },
    'HTML/price payload': v => { v.actualClassCandidates[0].selector = secret },
    'zero nodes': v => { v.actualClassCandidates[0].observedNodes = 0 },
    'noninteger nodes': v => { v.actualClassCandidates[0].observedNodes = 1.5 },
    'huge nodes': v => { v.actualClassCandidates[0].observedNodes = 501 },
    'string nodes': v => { v.actualClassCandidates[0].observedNodes = '2' },
    'verified flag': v => { v.actualClassCandidates[0].semanticVerified = true },
    'missing flag': v => { delete v.actualClassCandidates[0].semanticVerified },
    'extra notes': v => { v.actualClassCandidates[0].rawHtml = secret },
    'duplicate': v => { v.actualClassCandidates.push({ ...v.actualClassCandidates[0] }) },
  }
  for (const [name, tamper] of Object.entries(cases)) {
    const candidate = validReview()
    tamper(candidate)
    const result = await classifyReview(candidate)
    assert.equal(result.status, 'rejected', name)
    assert.equal(result.totals.rejected, 1, name)
    assert.equal(result.totals.pendingHumanReview, 0, name)
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE-SUPERMARKET|javascript:|rawHtml/, name)
  }
})
