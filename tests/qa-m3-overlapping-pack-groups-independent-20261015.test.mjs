import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

// Independent QA-only test of M3 physical group attribution. All evidence,
// brands, prices and products in this fixture are fictional and offline.
const NOW = Date.parse('2026-10-15T10:00:00Z')
const shops = ['plus', 'dekamarkt']
const requirements = [
  { id: 'breakfast', query: 'halfvolle melk ontbijt', amount: 100, unit: 'ml' },
  { id: 'dinner', query: 'halfvolle melk diner', amount: 0.1, unit: 'l' },
  { id: 'snack', query: 'halfvolle melk snack', amount: 100, unit: 'ml' },
]
const riceRequirement = { id: 'rice', query: 'basmati rijst', amount: 500, unit: 'g' }

function product(shop, id, name, price, unit = 'ml', amount = 500, availability = 'available') {
  return {
    supermarket: shop, sourceProductId: id, name, currency: 'EUR',
    currentPriceCents: price,
    pack: { amount, unit, rawText: amount + ' ' + unit },
    availability, offer: null,
    provenance: {
      supermarket: shop, kind: 'product',
      url: shop === 'plus'
        ? 'https://www.plus.nl/product/fictional-' + id
        : 'https://www.dekamarkt.nl/producten/fictional-' + id,
      sha256: 'a'.repeat(64), capturedAt: '2026-10-15T09:00:00Z',
    },
  }
}

function inventory(withRice, uncertain = false) {
  const rows = [
    // PLUS physical groups: [breakfast,dinner] and [snack].
    product('plus', 'shared-ab', 'Halfvolle melk ontbijt diner', 120),
    product('plus', 'single-c', 'Halfvolle melk snack', 70),
    // DekaMarkt physical groups: [breakfast] and [dinner,snack].
    product('dekamarkt', 'single-a', 'Halfvolle melk ontbijt', 90),
    product('dekamarkt', 'shared-bc', 'Halfvolle melk diner snack', 85,
      'ml', 500, uncertain ? 'unknown' : 'available'),
  ]
  if (withRice) {
    rows.push(product('plus', 'rice', 'Basmati rijst', 210, 'g'))
    rows.push(product('dekamarkt', 'rice', 'Basmati rijst', 230, 'g'))
  }
  return rows
}

function permutations(values) {
  return [
    values,
    [values[0], values[2], values[1]],
    [values[1], values[0], values[2]],
    [values[1], values[2], values[0]],
    [values[2], values[0], values[1]],
    [values[2], values[1], values[0]],
  ]
}

function compare(demands, observations) {
  const untouched = JSON.stringify({ demands, observations })
  const r = compareReviewedCatalogs({
    requirements: demands, observations, nowMs: NOW,
  })
  assert.equal(JSON.stringify({ demands, observations }), untouched)
  assert.equal(r.claimable, false)
  assert.equal(r.provenance, 'offline-snapshot-preview')
  return r
}

function assertPurchasedGroup(result, shop, groupIds, chargedCents) {
  const lines = result.lines.filter(row => groupIds.includes(row.ingredientId))
  const groupOwners = lines.filter(row => row[shop].sharedPackCoversIngredientIds)
  assert.equal(groupOwners.length, 1)
  const owner = groupOwners[0]
  assert.deepEqual([...owner[shop].sharedPackCoversIngredientIds].sort(), [...groupIds].sort())
  assert.equal(owner[shop].totalCents, chargedCents)
  assert.equal(owner[shop].packs, 1)
  for (const line of lines.filter(row => row !== owner)) {
    assert.equal(line[shop].sharedPackWithIngredientId, owner.ingredientId)
    assert.equal(line[shop].totalCents, 0)
    assert.equal(line[shop].packs, 0)
  }
}

for (const [order, three] of permutations(requirements).entries()) {
  test('independent overlapping-group oracle: order ' + order, () => {
    const r = compare(three, inventory(false))
    // Independent physical purchasing ledger: PLUS (120 + 70),
    // DekaMarkt (90 + 85). Not derived from product implementation.
    assert.equal(r.comparable, true)
    assert.equal(r.stores.plus.subtotalCents, 190)
    assert.equal(r.stores.dekamarkt.subtotalCents, 175)
    assert.equal(r.cheaperStore, 'dekamarkt')
    assert.equal(r.savingsCents, 15)
    assertPurchasedGroup(r, 'plus', ['breakfast', 'dinner'], 120)
    assertPurchasedGroup(r, 'dekamarkt', ['dinner', 'snack'], 85)
    for (const line of r.lines) {
      assert.equal(line.plus.status, 'matched')
      assert.equal(line.dekamarkt.status, 'matched')
      assert.equal(line.differenceCents, null,
        'overlapping-but-different physical groups cannot have independent price savings')
    }
  })

  test('independent overlapping-group oracle: order ' + order +
    ' + unrelated real physical rice pack', () => {
    const r = compare([...three, riceRequirement], inventory(true))
    assert.equal(r.comparable, true)
    assert.equal(r.stores.plus.subtotalCents, 400)
    assert.equal(r.stores.dekamarkt.subtotalCents, 405)
    assert.equal(r.cheaperStore, 'plus')
    assert.equal(r.savingsCents, 5)
    for (const row of r.lines.filter(line => line.ingredientId !== 'rice')) {
      assert.equal(row.differenceCents, null)
    }
    const rice = r.lines.find(line => line.ingredientId === 'rice')
    assert.equal(rice.plus.totalCents, 210)
    assert.equal(rice.dekamarkt.totalCents, 230)
    assert.equal(rice.differenceCents, 20)
    assert.equal(rice.plus.sharedPackWithIngredientId, undefined)
    assert.equal(rice.dekamarkt.sharedPackWithIngredientId, undefined)
  })

  test('independent overlapping-group oracle: order ' + order +
    ' + DekaMarkt unknown stock', () => {
    const r = compare([...three, riceRequirement], inventory(true, true))
    assert.equal(r.comparable, false)
    assert.equal(r.cheaperStore, null)
    assert.equal(r.savingsCents, null)
    assert.equal(r.stores.dekamarkt.complete, false)
    assertPurchasedGroup(r, 'plus', ['breakfast', 'dinner'], 120)
    assertPurchasedGroup(r, 'dekamarkt', ['dinner', 'snack'], 85)
    for (const row of r.lines.filter(line => line.ingredientId !== 'rice')) {
      assert.equal(row.differenceCents, null)
      if (['dinner', 'snack'].includes(row.ingredientId)) {
        assert.equal(row.dekamarkt.status, 'availability_unknown')
      }
    }
    assert.equal(r.lines.find(line => line.ingredientId === 'rice').differenceCents, 20)
  })
}

test('independent symmetric three-ingredient physical group still allows owner-group cents', () => {
  const all = 'Halfvolle melk ontbijt diner snack'
  const rows = [
    product('plus', 'shared-abc', all, 129),
    product('dekamarkt', 'shared-abc', all, 119),
  ]
  const r = compare(requirements, rows)
  assert.equal(r.comparable, true)
  assert.equal(r.cheaperStore, 'dekamarkt')
  assert.equal(r.savingsCents, 10)
  assert.equal(r.lines[0].differenceCents, -10)
  for (const line of r.lines.slice(1)) {
    assert.equal(line.differenceCents, 0)
    assert.equal(line.plus.sharedPackWithIngredientId, 'breakfast')
    assert.equal(line.dekamarkt.sharedPackWithIngredientId, 'breakfast')
  }
})
