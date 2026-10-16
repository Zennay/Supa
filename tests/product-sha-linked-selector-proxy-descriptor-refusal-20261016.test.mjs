import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { proposeRetailerSelectors } from '../scripts/retailer-snapshot-selector-proposals.mjs'

// Pure offline synthetic sources; a good SHA never grants retailer permissions.
const html = '<main><article class="product-card"><span class="price-value">synthetic</span></article></main>'
const digest = createHash('sha256').update(html).digest('hex')
const original = store => ({
  id: store + '-synthetic-reviewed',
  supermarket: store,
  kind: 'catalog',
  url: store === 'plus' ? 'https://www.plus.nl/producten' :
    'https://www.dekamarkt.nl/producten/',
  capturedAt: '2026-10-14T12:00:00.000000001Z',
  sha256: digest,
})

test('SHA-linked API refuses live proxies without calling property descriptor traps', () => {
  for (const store of ['plus', 'dekamarkt']) {
    let traps = 0
    const proxy = new Proxy(original(store), {
      getOwnPropertyDescriptor(object, key) {
        traps++
        return Reflect.getOwnPropertyDescriptor(object, key)
      },
      get(object, key) {
        traps++
        return Reflect.get(object, key)
      },
    })
    assert.throws(() => proposeRetailerSelectors(proxy, html),
      /Offline selector review refused: malformed source/)
    assert.equal(traps, 0)
  }
})

test('SHA-linked API refuses revoked proxies with operator-only errors', () => {
  for (const store of ['plus', 'dekamarkt']) {
    const { proxy, revoke } = Proxy.revocable(original(store), {})
    revoke()
    assert.throws(() => proposeRetailerSelectors(proxy, html),
      /Offline selector review refused: malformed source/)
  }
})

test('SHA-linked API keeps plain historical captures private and untouched', () => {
  for (const store of ['plus', 'dekamarkt']) {
    const source = original(store)
    const before = structuredClone(source)
    const output = proposeRetailerSelectors(source, html)
    assert.equal(output.source.sha256, digest)
    assert.equal(output.source.capturedAt, source.capturedAt)
    assert.equal(output.source.supermarket, store)
    assert.equal(output.sourcePermissionVerified, false)
    assert.equal(output.readyForScraping, false)
    assert.equal(output.currentPricesExtracted, false)
    assert.equal(output.publicationAllowed, false)
    assert.deepEqual(source, before)
    assert.ok(output.proposedSelectors.every(s => s.status === 'UNVERIFIED_PROPOSAL'))
  }
})
