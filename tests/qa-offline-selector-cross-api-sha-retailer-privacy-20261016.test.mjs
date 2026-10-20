import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { proposeOfflineRetailerSelectors } from '../scripts/retailer-offline-selector-discovery.mjs'
import { proposeRetailerSelectors } from '../scripts/retailer-snapshot-selector-proposals.mjs'

// INDEPENDENT M3 QA: compare two different in-process offline selector entrypoints
// using ONLY fictional strings with exact SHA. No HTTP/production or source rights.
const capturedAt = '2026-10-14T12:00:00.000Z'
const html = '<html><body><section class="product-card"><span class="price-value">not-a-retailer-price</span></section></body></html>'
const digest = createHash('sha256').update(html, 'utf8').digest('hex')
const known = [
  ['plus', 'https://www.plus.nl/producten'],
  ['dekamarkt', 'https://www.dekamarkt.nl/producten/'],
]

test('cross-entrypoint M3: SHA, physical historical time and retailer attribution agree for both actual host identities', () => {
  for (const [retailerId, url] of known) {
    const origin = { retailerId, url, capturedAt }
    const reviewed = { id: retailerId + '-qa-synthetic-archive', supermarket: retailerId,
      kind: 'catalog', url, capturedAt, sha256: digest }
    const original = structuredClone({ origin, reviewed })
    const generic = proposeOfflineRetailerSelectors({ html, origin })
    const pinned = proposeRetailerSelectors(reviewed, html)
    assert.equal(generic.source.sha256, digest)
    assert.equal(pinned.source.sha256, digest)
    assert.equal(generic.source.retailerId, retailerId)
    assert.equal(pinned.source.supermarket, retailerId)
    assert.equal(generic.source.capturedAt, capturedAt)
    assert.equal(pinned.source.capturedAt, capturedAt)
    assert.equal(pinned.source.url, url)
    assert.equal(generic.readyForIngestion, false)
    assert.equal(generic.permissionVerified, false)
    assert.equal(generic.productionEnabled, false)
    assert.equal(generic.publicSavingsClaimEligible, false)
    assert.equal(pinned.readyForScraping, false)
    assert.equal(pinned.sourcePermissionVerified, false)
    assert.equal(pinned.currentPricesExtracted, false)
    assert.equal(pinned.publicationAllowed, false)
    assert.ok(generic.selectors.every(x => x.status === 'needs-human-review'))
    assert.ok(pinned.proposedSelectors.every(x => x.status === 'UNVERIFIED_PROPOSAL'))
    assert.deepEqual({ origin, reviewed }, original)
    assert.doesNotMatch(JSON.stringify(generic), /not-a-retailer-price|www\\.plus\\.nl|www\\.dekamarkt\\.nl/i)
    assert.doesNotMatch(JSON.stringify(pinned), /not-a-retailer-price/i)
  }
})

test('cross-entrypoint M3: SHA-bound selector refuses changed HTML; independent proposal rehashes but never licenses', () => {
  for (const [retailerId, url] of known) {
    const origin = { retailerId, url, capturedAt }
    const reviewed = { id: retailerId + '-qa-hash-locked',
      supermarket: retailerId, kind: 'catalog', url, capturedAt, sha256: digest }
    const changedHtml = html.replace('not-a-retailer-price', 'altered-fictional-content')
    assert.notEqual(changedHtml, html)
    assert.throws(() => proposeRetailerSelectors(reviewed, changedHtml),
      /Offline selector review refused/)
    const preview = proposeOfflineRetailerSelectors({ html: changedHtml, origin })
    assert.notEqual(preview.source.sha256, digest)
    assert.equal(preview.source.sha256, createHash('sha256').update(changedHtml).digest('hex'))
    assert.equal(preview.permissionVerified, false)
    assert.equal(preview.publicSavingsClaimEligible, false)
  }
})

test('cross-entrypoint M3: repeated offline review cannot silently change SHA or proposal count', () => {
  for (const [retailerId, url] of known) {
    const origin = { retailerId, url, capturedAt }
    const reviewed = { id: retailerId + '-qa-deterministic',
      supermarket: retailerId, kind: 'catalog', url, capturedAt, sha256: digest }
    const first = proposeOfflineRetailerSelectors({ html, origin })
    const second = proposeOfflineRetailerSelectors({ html, origin })
    assert.deepEqual(first, second)
    assert.deepEqual(proposeRetailerSelectors(reviewed, html),
      proposeRetailerSelectors(reviewed, html))
  }
})
