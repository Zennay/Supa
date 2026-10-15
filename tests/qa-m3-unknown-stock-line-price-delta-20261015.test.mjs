import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

// Independent financial-presentation QA. Fully fictional offline pack prices and
// products. No retailer HTTP, credentials, human field evidence or claimed savings.
const NOW = Date.parse('2026-10-15T10:00:00Z')
const requirement = [{ id: 'milk', query: 'halfvolle melk', amount: 1500, unit: 'ml' }]

function milk(shop, cents, availability = 'available') {
  return {
    supermarket: shop, sourceProductId: 'fictional-milk-' + shop,
    name: 'Halfvolle melk', currentPriceCents: cents, currency: 'EUR',
    pack: { rawText: '1 l', amount: 1000, unit: 'ml' },
    offer: null, availability,
    provenance: {
      supermarket: shop, kind: 'product',
      url: shop === 'plus'
        ? 'https://www.plus.nl/product/fictional-milk'
        : 'https://www.dekamarkt.nl/producten/fictional-milk',
      capturedAt: '2026-10-15T09:00:00Z', sha256: 'e'.repeat(64),
    },
  }
}

function compare(a, b, plusCents, dekaCents) {
  const observations = [milk('plus', plusCents, a), milk('dekamarkt', dekaCents, b)]
  const initial = JSON.stringify(observations)
  const result = compareReviewedCatalogs({
    observations, requirements: requirement, nowMs: NOW,
  })
  assert.equal(JSON.stringify(observations), initial)
  assert.equal(result.provenance, 'offline-snapshot-preview')
  assert.equal(result.claimable, false)
  return result
}

for (const [plusCents, dekaCents, expectedDelta, label] of [
  [129, 119, -20, 'cheaper DekaMarkt'],
  [119, 129, 20, 'cheaper PLUS'],
  [119, 119, 0, 'equal quoted prices'],
  [0, 119, 238, 'zero-cent PLUS quote'],
]) {
  test('control: confirmed stock preserves only genuine per-line quoted delta: ' + label, () => {
    const r = compare('available', 'available', plusCents, dekaCents)
    assert.equal(r.comparable, true)
    assert.equal(r.lines[0].plus.status, 'matched')
    assert.equal(r.lines[0].dekamarkt.status, 'matched')
    assert.equal(r.lines[0].differenceCents, expectedDelta)
    assert.equal(r.savingsCents, Math.abs(expectedDelta))
  })
}

for (const [a, b] of [
  ['available', 'unknown'],
  ['unknown', 'available'],
  ['unknown', 'unknown'],
]) {
  for (const [plusCents, dekaCents, label] of [
    [129, 119, 'DekaMarkt quote looks cheaper'],
    [119, 129, 'PLUS quote looks cheaper'],
    [119, 119, 'equal quoted prices'],
    [0, 119, 'zero-cent quote'],
  ]) {
    test('EXPECTED RED: do not publish an item price *difference* without confirmed pair stock: ' +
      a + ' / ' + b + ', ' + label, () => {
      const r = compare(a, b, plusCents, dekaCents)
      assert.equal(r.comparable, false, 'full basket already refuses winner')
      assert.equal(r.cheaperStore, null)
      assert.equal(r.savingsCents, null)
      assert.equal(r.stores.plus.complete && r.stores.dekamarkt.complete, false)
      // The status can transparently expose that a quote exists without
      // equating a stocked physical item with an uncertain listing.
      assert.equal(r.lines[0].plus.status, a === 'available' ? 'matched' : 'availability_unknown')
      assert.equal(r.lines[0].dekamarkt.status, b === 'available' ? 'matched' : 'availability_unknown')
      assert.equal(r.lines[0].differenceCents, null,
        'an unknown-stock SKU cannot establish a realizable line saving/delta')
    })
  }
}

// A separate confidently stocked ingredient may still have a known unit-price
// difference: the regression must not blank unrelated trustworthy line data.
test('positive: one uncertain basket line does not blank an independent confirmed-price row', () => {
  const rice = shop => ({
    ...milk(shop, shop === 'plus' ? 215 : 225, 'available'),
    sourceProductId: 'fictional-basmati-' + shop, name: 'Basmati rijst',
    pack: { rawText: '500 g', amount: 500, unit: 'g' },
    provenance: { ...milk(shop, 100).provenance,
      url: shop === 'plus'
        ? 'https://www.plus.nl/product/fictional-basmati'
        : 'https://www.dekamarkt.nl/producten/fictional-basmati' },
  })
  const observations = [milk('plus', 129), milk('dekamarkt', 119, 'unknown'),
    rice('plus'), rice('dekamarkt')]
  const original = JSON.stringify(observations)
  const r = compareReviewedCatalogs({
    requirements: [...requirement, { id: 'rice', query: 'basmati rijst', amount: 500, unit: 'g' }],
    observations, nowMs: NOW,
  })
  assert.equal(r.comparable, false)
  assert.equal(r.savingsCents, null)
  assert.equal(r.cheaperStore, null)
  assert.equal(r.lines[0].differenceCents, null)
  assert.equal(r.lines[1].plus.status, 'matched')
  assert.equal(r.lines[1].dekamarkt.status, 'matched')
  assert.equal(r.lines[1].differenceCents, 10)
  assert.equal(JSON.stringify(observations), original)
})
