import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2Products, m2Store } from '../src/data/m2Fixture.ts'

// No retailer calls or observations. Price levels and ingredients are a
// controlled development fixture, not evidence of savings in real stores.
function basket({ quantity, unit, candidate, product }) {
  const store = candidate ? { id: 'fictional-candidate', name: 'Fictieve tweede winkel' } : m2Store
  const storeProduct = {
    ...product,
    id: candidate ? 'fictional-candidate-product' : product.id,
    storeId: store.id,
    priceCents: product.priceCents + Number(candidate),
  }
  const recipe = {
    id: 'fictional-unit-demand',
    title: 'Fictieve maaltijd',
    minutes: 10,
    servings: 1,
    estimatedCost: 1,
    tags: [],
    ingredients: [{
      id: 'fictional-shared-demand',
      label: product.id === 'basmati-1kg' ? 'Basmati rijst' : 'Teriyaki saus',
      query: product.id === 'basmati-1kg' ? 'basmati rijst' : 'teriyaki saus',
      amount: quantity,
      unit,
    }],
  }
  return buildOneStoreBasket({
    store,
    plan: [{ day: 'Ma', recipeId: recipe.id }],
    recipes: [recipe],
    activeDays: ['Ma'],
    products: [storeProduct],
  })
}

test('QA M3: 200 complete two-store baskets refuse even 1g / 1ml mismatches hidden inside the same paid pack', () => {
  let checked = 0
  for (const [small, large, sku] of [
    ['g', 'kg', 'basmati-1kg'],
    ['ml', 'l', 'teriyaki-250'],
  ]) {
    const product = m2Products.find(entry => entry.id === sku)
    assert.ok(product, sku)
    for (let amount = 120; amount < 220; amount++) {
      const baseline = basket({ quantity: amount, unit: small, candidate: false, product })
      const sameDemand = basket({ quantity: amount / 1000, unit: large, candidate: true, product })
      const differentDemand = basket({ quantity: (amount + 1) / 1000, unit: large, candidate: true, product })
      for (const p of [baseline, sameDemand, differentDemand]) {
        assert.equal(p.selectedMealCount, 1)
        assert.equal(p.matchedLineCount, 1, `${sku} ${amount}`)
        assert.equal(p.unresolvedLineCount, 0)
        assert.equal(p.lines[0].packs, 1, `${sku} ${amount}`)
      }
      const good = compareFullBaskets({ baseline, candidate: sameDemand })
      assert.equal(good.claimable, true, `equal physical demand ${sku}/${amount}: ${good.reasons.join('; ')}`)
      assert.equal(good.outcome, 'worse')
      assert.equal(good.deltaCents, 1)
      assert.equal(good.savingsCents, -1)

      const forged = compareFullBaskets({ baseline, candidate: differentDemand })
      assert.equal(forged.claimable, false, `1 base-unit difference must be refused: ${sku}/${amount}`)
      assert.equal(forged.outcome, 'unknown')
      assert.equal(forged.deltaCents, null)
      assert.equal(forged.savingsCents, null)
      assert.deepEqual(forged.lineDeltas, [])
      assert.match(forged.reasons.join(' '), /demand differs/i)
      // Changing quantity must not alter pack count or raw monetary totals
      // in this constructed test: only physical demand trust rejects the claim.
      assert.equal(sameDemand.totalCents, differentDemand.totalCents)
      checked++
    }
  }
  assert.equal(checked, 200)
})
