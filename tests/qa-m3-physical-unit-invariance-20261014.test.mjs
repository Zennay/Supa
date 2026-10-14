import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregatePlanIngredients, buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { sumDecimalDemandUnits, calculateDecimalPackCount } from '../src/domain/decimalPackArithmetic.ts'
import { m2Products, m2Store } from '../src/data/m2Fixture.ts'

// These are fictional integer-gram/millilitre demands and shop values.
// Every expected pack count is independently calculated in whole base units.
test('QA M3: 12,800 independently metered mass/volume pairs are invariant to unit spelling and order', () => {
  let verified = 0
  for (const [small, large] of [['g', 'kg'], ['ml', 'l']]) {
    for (let a = 1; a <= 80; a++) for (let b = 1; b <= 80; b++) {
      const left = a * 19
      const right = b * 23
      const demand = [
        { amount: left, unit: small },
        { amount: right / 1000, unit: large },
      ]
      const reversed = [...demand].reverse()
      const baseTotal = left + right
      const expectedPacks = Math.floor((baseTotal + 124) / 125)

      assert.equal(sumDecimalDemandUnits(demand, small), baseTotal, `${small} ${a}/${b}`)
      assert.equal(sumDecimalDemandUnits(reversed, small), baseTotal)
      assert.equal(sumDecimalDemandUnits(demand, large), baseTotal / 1000)
      assert.equal(sumDecimalDemandUnits(reversed, large), baseTotal / 1000)
      assert.equal(calculateDecimalPackCount(demand, { amount: 125, unit: small }), expectedPacks)
      assert.equal(calculateDecimalPackCount(reversed, { amount: 0.125, unit: large }), expectedPacks)
      assert.equal(calculateDecimalPackCount(demand, { amount: 0.125, unit: large }), expectedPacks)
      verified++
    }
  }
  assert.equal(verified, 12_800)
})

test('QA M3: generated genuinely built baskets agree across physical g/kg representations and full-store signed cents', () => {
  const rice = m2Products.find(product => product.id === 'basmati-1kg')
  assert.ok(rice)
  let verified = 0
  for (let i = 1; i <= 20; i++) for (let j = 1; j <= 20; j++) {
    const g1 = i * 41
    const g2 = j * 47
    const common = { id: 'basmati-rice', label: 'Basmati rijst', query: 'basmati rijst' }
    const recipes = [
      { id: 'fictional-a', title: 'A', minutes: 15, servings: 1, estimatedCost: 1, tags: [], ingredients: [{ ...common, amount: g1 / 1000, unit: 'kg' }] },
      { id: 'fictional-b', title: 'B', minutes: 15, servings: 1, estimatedCost: 1, tags: [], ingredients: [{ ...common, amount: g2, unit: 'g' }] },
    ]
    const plan = [{ day: 'Ma', recipeId: 'fictional-a' }, { day: 'Di', recipeId: 'fictional-b' }]
    const activeDays = ['Ma', 'Di']
    const input = { plan, recipes, activeDays }
    const snapshot = structuredClone(input)
    const aggregate = aggregatePlanIngredients(plan, recipes, activeDays)
    assert.equal(aggregate.length, 1)
    assert.equal(aggregate[0].unit, 'kg')
    assert.equal(aggregate[0].amount, (g1 + g2) / 1000)
    const baseline = buildOneStoreBasket({
      ...input, store: m2Store, products: [rice],
    })
    const candidateStore = { id: 'fictional-candidate-store', name: 'Fictieve tweede winkel' }
    const candidate = buildOneStoreBasket({
      ...input, store: candidateStore,
      products: [{ ...rice, id: `fictional-${i}-${j}`, storeId: candidateStore.id, priceCents: rice.priceCents + 1 }],
    })
    const expectedPacks = Math.ceil((g1 + g2) / 1000)
    assert.equal(baseline.matchedLineCount, 1)
    assert.equal(candidate.matchedLineCount, 1)
    assert.equal(baseline.lines[0].packs, expectedPacks)
    assert.equal(candidate.lines[0].packs, expectedPacks)
    assert.equal(baseline.totalCents, expectedPacks * rice.priceCents)
    assert.equal(candidate.totalCents, expectedPacks * (rice.priceCents + 1))
    const candidateControl = structuredClone(candidate)
    candidate.lines[0].requirement = { amount: g1 + g2, unit: 'g' }
    const result = compareFullBaskets({ baseline, candidate })
    assert.equal(result.claimable, true, `g1=${g1} g2=${g2}: ${result.reasons.join('; ')}`)
    assert.equal(result.outcome, 'worse')
    assert.equal(result.deltaCents, expectedPacks)
    assert.equal(result.savingsCents, -expectedPacks)
    assert.equal(result.lineDeltas.length, 1)
    assert.deepEqual(input, snapshot, 'Original user-defined recipes must remain immutable')
    assert.equal(candidateControl.totalCents, candidate.totalCents)
    verified++
  }
  assert.equal(verified, 400)
})

test('QA M3: a volume/mass family mismatch must never masquerade as the same weekly price demand', () => {
  for (const incompatible of [
    [{ amount: 120, unit: 'g' }, { amount: 0.12, unit: 'l' }],
    [{ amount: 250, unit: 'ml' }, { amount: 0.25, unit: 'kg' }],
    [{ amount: 1, unit: 'piece' }, { amount: 0.001, unit: 'kg' }],
  ]) {
    assert.equal(sumDecimalDemandUnits(incompatible, incompatible[0].unit), null)
    assert.equal(calculateDecimalPackCount(incompatible, { amount: 250, unit: incompatible[0].unit }), null)
  }
})
