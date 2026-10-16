import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { proposeRetailerSelectors } from '../scripts/retailer-snapshot-selector-proposals.mjs'

// This independent entrypoint consumes ONLY synthetic, already reviewed HTML
// supplied in memory. It NEVER fetches a URL or demonstrates retailer rights.
const html = '<html><body><article class="product-card"><span class="price-value">redacted</span></article></body></html>'
const sha = createHash('sha256').update(html).digest('hex')
const createSource = (supermarket, capturedAt) => ({
  id: supermarket + '-synthetic-reviewed-catalog',
  supermarket,
  kind: 'catalog',
  url: supermarket === 'plus'
    ? 'https://www.plus.nl/producten'
    : 'https://www.dekamarkt.nl/producten/',
  capturedAt,
  sha256: sha,
})
const propose = (supermarket, date) => proposeRetailerSelectors(createSource(supermarket, date), html)

test('QA expected RED: SHA-verified approved capture may not preserve impossible February 30 as provenance', () => {
  for (const store of ['plus', 'dekamarkt']) {
    assert.throws(() => propose(store, '2026-02-30T12:00:00.000Z'),
      /Offline selector review refused:/)
  }
})

test('QA expected RED: century nonleap Feb 29 and April 31 cannot enter SHA-linked selector review', () => {
  for (const store of ['plus', 'dekamarkt']) {
    for (const capturedAt of [
      '1900-02-29T10:00:00.000Z',
      '2025-02-29T10:00:00.000Z',
      '2026-04-31T10:00:00.000Z',
    ]) {
      assert.throws(() => propose(store, capturedAt),
        /Offline selector review refused:/, store + ' ' + capturedAt)
    }
  }
})

test('QA positive: physically valid leap days retain matching raw SHA and no automated selector rights', () => {
  for (const store of ['plus', 'dekamarkt']) {
    for (const capturedAt of ['2000-02-29T12:00:00.000Z', '2024-02-29T12:00:00.000Z']) {
      const source = createSource(store, capturedAt)
      const before = structuredClone(source)
      const result = proposeRetailerSelectors(source, html)
      assert.equal(result.source.supermarket, store)
      assert.equal(result.source.capturedAt, capturedAt)
      assert.equal(result.source.sha256, sha)
      assert.equal(result.readyForScraping, false)
      assert.equal(result.sourcePermissionVerified, false)
      assert.equal(result.currentPricesExtracted, false)
      assert.equal(result.publicationAllowed, false)
      assert.ok(result.proposedSelectors.every(row =>
        row.status === 'UNVERIFIED_PROPOSAL' && row.requiresReviewedSnapshotAndHumanApproval))
      assert.deepEqual(source, before)
      assert.doesNotMatch(JSON.stringify(result), /redacted|price-value">/i)
    }
  }
})

test('QA positive: mismatched bytes and future source time still refuse without HTTP', () => {
  for (const store of ['plus', 'dekamarkt']) {
    assert.throws(() => propose(store, '2999-02-01T12:00:00.000Z'),
      /Offline selector review refused:/)
    const wrongHash = createSource(store, '2026-10-14T12:00:00.000Z')
    wrongHash.sha256 = 'f'.repeat(64)
    assert.throws(() => proposeRetailerSelectors(wrongHash, html),
      /Offline selector review refused:/)
  }
})
