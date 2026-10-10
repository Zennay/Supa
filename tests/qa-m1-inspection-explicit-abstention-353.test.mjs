import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { inspectCaptureDirectory } from '../scripts/m1-inspect-captures.mjs'

// Independent issue #353 QA: test-only, synthetic and checksum-valid captures.
// No real PLUS source value, scraping, M3 evidence, or owner source modification.
async function inspectSyntheticProduct(html) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'supa-qa-empty-jsonld-'))
  try {
    await mkdir(path.join(root, 'plus'))
    const sha256 = createHash('sha256').update(html).digest('hex')
    await writeFile(path.join(root, 'plus', 'plus-product.html'), html, 'utf8')
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify({
      milestone: 'M1 Data Feasibility', bounded: true,
      sourceCount: 1, successCount: 1, failureCount: 0,
      startedAt: '2026-10-10T12:00:00Z',
      completedAt: '2026-10-10T12:01:00Z',
      results: [{
        id: 'plus-product', supermarket: 'plus', kind: 'product',
        success: true, sha256,
        requestedUrl: 'https://www.plus.nl/synthetic-product',
        finalUrl: 'https://www.plus.nl/synthetic-product',
        capturedAt: '2026-10-10T12:00:30Z',
      }],
    }), 'utf8')
    return await inspectCaptureDirectory(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function assertExplainedAbstention(report) {
  assert.equal(report.integrityVerifiedCount, 1)
  const record = report.sources[0]
  assert.equal(record.success, true)
  assert.equal(record.integrity, 'verified')
  assert.equal(record.schemaOrgProduct.type, 'abstain')
  assert.ok(Array.isArray(record.schemaOrgProduct.reasons))
  assert.ok(record.schemaOrgProduct.reasons.length > 0, 'must explain safe abstention')
  assert.ok(record.schemaOrgProduct.reasons.every(
    (reason) => typeof reason === 'string' && reason.trim().length > 0,
  ))
  assert.equal(JSON.stringify(report).includes('synthetic-private-marker'), false)
}

test('QA #353: checksum-valid page without JSON-LD abstains with an explicit explanation', async () => {
  const report = await inspectSyntheticProduct(
    '<!doctype html><html><head><title>Fixture</title></head><body></body></html>',
  )
  assertExplainedAbstention(report)
})

test('QA #353: malformed JSON-LD discarded during parsing still has a nonempty abstention reason', async () => {
  const report = await inspectSyntheticProduct(
    '<html><script type="application/ld+json">{unparseable</script></html>',
  )
  assertExplainedAbstention(report)
})

test('QA #353: preserve useful parser reason rather than replacing every abstention with a generic fallback', async () => {
  const report = await inspectSyntheticProduct(
    '<html><script type="application/ld+json">{"@type":"Product","sku":"fixture"}</script></html>',
  )
  assertExplainedAbstention(report)
  assert.ok(report.sources[0].schemaOrgProduct.reasons.some(
    (reason) => /usable name/i.test(reason),
  ))
})
