import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { proposeRetailerSelectors } from '../scripts/retailer-snapshot-selector-proposals.mjs'

// Programmatic, strictly offline verification of the SECOND SHA-linked selector
// entrypoint. All HTML/source identity values are synthetic in-memory records;
// no store requests, retailer permission or public savings evidence is implied.
const html = '<main><article class="product-card"><span class="price-value">fictional</span></article></main>'
const sha = createHash('sha256').update(html, 'utf8').digest('hex')
function ownedSource(store = 'plus') {
  return {
    id: 'qa-synthetic-source',
    supermarket: store,
    kind: 'catalog',
    url: store === 'plus'
      ? 'https://www.plus.nl/producten'
      : 'https://www.dekamarkt.nl/producten/',
    capturedAt: '2026-10-14T12:00:00.000Z',
    sha256: sha,
  }
}
const refusal = /Offline selector review refused/

test('QA expected RED: plain-looking Proxy source must refuse without firing own-property descriptor traps', () => {
  for (const store of ['plus', 'dekamarkt']) {
    let executed = 0
    const proxy = new Proxy(ownedSource(store), {
      getOwnPropertyDescriptor(target, key) {
        executed++
        return Reflect.getOwnPropertyDescriptor(target, key)
      },
    })
    assert.throws(() => proposeRetailerSelectors(proxy, html), refusal,
      store + ' Proxy must be rejected before invoking any trap')
    assert.equal(executed, 0, store + ' must not execute getOwnPropertyDescriptor traps')
  }
})

test('QA expected RED: revoked Proxy source cannot expose native TypeError in private error contract', () => {
  for (const store of ['plus', 'dekamarkt']) {
    const { proxy, revoke } = Proxy.revocable(ownedSource(store), {})
    revoke()
    assert.throws(() => proposeRetailerSelectors(proxy, html), refusal,
      store + ' revoked Proxy must fail with generic operator-only refusal')
  }
})

test('QA positive: non-proxy ordinary own-data PLUS/Deka sources preserve SHA and publish nothing', () => {
  for (const store of ['plus', 'dekamarkt']) {
    const source = ownedSource(store)
    const snapshot = structuredClone(source)
    const report = proposeRetailerSelectors(source, html)
    assert.equal(report.source.supermarket, store)
    assert.equal(report.source.sha256, sha)
    assert.equal(report.source.capturedAt, source.capturedAt)
    assert.equal(report.readyForScraping, false)
    assert.equal(report.sourcePermissionVerified, false)
    assert.equal(report.currentPricesExtracted, false)
    assert.equal(report.publicationAllowed, false)
    assert.deepEqual(source, snapshot)
    assert.ok(report.proposedSelectors.every(x =>
      x.status === 'UNVERIFIED_PROPOSAL' && x.requiresReviewedSnapshotAndHumanApproval))
    assert.doesNotMatch(JSON.stringify(report), /fictional/i)
  }
})

test('QA positive: own accessor identity is already refused without running the getter', () => {
  const source = ownedSource()
  let executed = 0
  Object.defineProperty(source, 'supermarket', {
    enumerable: true,
    get() { executed++; return 'plus' },
  })
  assert.throws(() => proposeRetailerSelectors(source, html), refusal)
  assert.equal(executed, 0)
})
