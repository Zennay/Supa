import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import {
  buildBudgetedPrivateRetailerCatalog,
  snapshotBoundedPrivateCatalogInput,
  PRIVATE_CATALOG_BUDGET,
} from '../scripts/retailer-private-budgeted-catalog.mjs'

const refused = /Private offline catalog input refused/
const genuine = async () => structuredClone(await loadReviewedRepositoryFixtures())

test('six actual archived PLUS/Deka reviewed shapes build only a private historical catalog', async () => {
  const batch = await genuine()
  const untouched = structuredClone(batch)
  const catalog = buildBudgetedPrivateRetailerCatalog(batch)
  assert.equal(catalog.status, 'private-review-only')
  assert.equal(catalog.sourceCount, 6)
  assert.equal(catalog.productionEnabled, false)
  assert.equal(catalog.publicSavingsClaimEligible, false)
  assert.ok(catalog.productCount > 0)
  assert.ok(catalog.captureCount > 0)
  for (const item of catalog.products) {
    assert.equal(item.currentTrustedPriceCents, null)
    assert.equal(item.publishable, false)
    assert.equal(item.sourceRightsVerified, false)
  }
  assert.deepEqual(batch, untouched)
})

test('detached and frozen inputs cannot change after caller modifies source', async () => {
  const batch = await genuine()
  const copy = snapshotBoundedPrivateCatalogInput(batch)
  assert.notEqual(copy, batch)
  assert.equal(Object.isFrozen(copy.results[0].observations[0].provenance), true)
  const original = copy.results[0].observations[0].name
  batch.results[0].observations[0].name = 'changed in caller'
  assert.equal(copy.results[0].observations[0].name, original)
})

test('oversized UTF-8 primitive values fail closed even in ignored fields', async () => {
  for (const mutate of [
    b => { b.summary.ignored = 'x'.repeat(PRIVATE_CATALOG_BUDGET.perStringUtf8Bytes + 1) },
    b => { b.results[0].observations[0].name = '🛒'.repeat(262_145) },
    b => { b.results[0].observations[0].provenance.url =
      'https://example.com/path?q=' + 'x'.repeat(1_048_576) },
    b => { b.results[0].observations[0].offer = { title: 'é'.repeat(524_289) } },
  ]) {
    const input = await genuine()
    mutate(input)
    assert.throws(() => buildBudgetedPrivateRetailerCatalog(input), refused)
  }
})

test('cumulative small ignored strings and keys cannot escape aggregate budget', async () => {
  const batch = await genuine()
  batch.summary.extra = {}
  for (let i = 0; i < 1_100; i++) {
    batch.summary.extra['field' + i] = 'x'.repeat(2_000)
  }
  assert.throws(() => buildBudgetedPrivateRetailerCatalog(batch), refused)
})

test('a raw non-plain, inherited, accessor or Proxy input is never evaluated', async () => {
  for (const mutate of [
    b => { Object.setPrototypeOf(b.summary, { mode: 'reviewed-offline-only' }) },
    b => { Object.defineProperty(b.summary, 'ignored', { enumerable: true,
      get() { throw new Error('caller getter ran') } }) },
    b => { b.results[0].observations[0] = new Proxy(b.results[0].observations[0], {
      get() { throw new Error('caller get trap ran') },
      ownKeys() { throw new Error('caller ownKeys trap ran') },
    }) },
    b => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); b.summary.extra = proxy },
    b => { b.results[0].observations[0][Symbol('invisible')] = 'secret' },
    b => { b.results[0].observations[0].unreadable = () => {} },
    b => { b.summary.cycle = b },
  ]) {
    const input = await genuine()
    mutate(input)
    assert.throws(() => buildBudgetedPrivateRetailerCatalog(input), refused)
  }
})

test('dense small UTF-8 metadata can be pinned, while sparse and exotic arrays fail closed', async () => {
  const b = { safe: ['één', 'twee'], meta: { count: 2, ok: true, none: null } }
  assert.deepEqual(snapshotBoundedPrivateCatalogInput(b), b)
  assert.ok(Object.isFrozen(snapshotBoundedPrivateCatalogInput(b)))
  const sparse = { ...b, safe: new Array(2) }
  sparse.safe[0] = 'first'
  assert.throws(() => snapshotBoundedPrivateCatalogInput(sparse), refused)
  const extra = { ...b, safe: ['ok'] }
  extra.safe.source = 'extra'
  assert.throws(() => snapshotBoundedPrivateCatalogInput(extra), refused)
})
