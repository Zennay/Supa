import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { preparePrintableShoppingChecklist } from '../src/features/shopping-list/printableShoppingChecklist.ts'

// Independent QA: a paper purchase instruction must equal an *exact* physical
// pack ceiling. No retailer pages, human observations, prices or M3 evidence.
const original = buildOneStoreBasket({
  store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
  activeDays: m2DefaultActiveDays, products: m2Products,
})
const firstIndex = original.lines.findIndex(line => line.status === 'matched')
assert.ok(firstIndex >= 0, 'synthetic fixture must contain a matched line')

function physicalAmount(ticks, unit) {
  // ticks are hundredths of a gram/millilitre, or hundredths of a kg/litre
  // converted to the same base family. Decimals are intentionally ordinary.
  return ['kg', 'l'].includes(unit) ? ticks / 100_000 : ticks / 100
}

function printOne({ requiredTicks, requiredUnit, packTicks, packUnit, count, packs }) {
  const basket = structuredClone(original)
  const line = basket.lines[firstIndex]
  line.requirement = {
    amount: physicalAmount(requiredTicks, requiredUnit),
    unit: requiredUnit,
  }
  line.pack = {
    amount: physicalAmount(packTicks, packUnit),
    unit: packUnit,
    count,
  }
  line.packs = packs
  const before = structuredClone(basket)
  const printed = preparePrintableShoppingChecklist(basket)
  assert.deepEqual(basket, before, 'printing must not mutate the physical basket')
  assert.equal(printed.lines.length, original.lines.length)
  assert.deepEqual(printed.lines.map(item => item.id), original.lines.map(item => item.id))
  assert.equal(printed.reviewCount, printed.lines.filter(item => item.needsReview).length)
  const row = printed.lines[firstIndex]
  assert.equal(row.id, line.id)
  assert.doesNotMatch(JSON.stringify(printed), /priceCents|savingsCents|observedAt|publicSavingsClaimEligible|€/)
  return row
}

test('QA paper M3: 3,600 exact gram/kilogram and millilitre/litre multipack ceilings', () => {
  let checks = 0
  const families = [
    ['g', 'g'], ['g', 'kg'], ['kg', 'g'],
    ['ml', 'ml'], ['ml', 'l'], ['l', 'ml'],
  ]
  for (const [requiredUnit, packUnit] of families) {
    for (let requiredTicks = 1; requiredTicks <= 25; requiredTicks++) {
      for (const packTicks of [1, 2, 3, 4, 5, 7, 10, 11]) {
        for (const count of [1, 2, 3]) {
          // Independent integer-ratio oracle; no IEEE-754 divide-and-ceil.
          const capacityTicks = packTicks * count
          const exactPacks = Math.floor((requiredTicks - 1) / capacityTicks) + 1
          const ctx = { requiredTicks, requiredUnit, packTicks, packUnit, count }
          const row = printOne({ ...ctx, packs: exactPacks })
          assert.equal(row.needsReview, false, JSON.stringify(ctx))
          assert.match(row.quantity, /×/, JSON.stringify(ctx))
          assert.doesNotMatch(row.quantity, /handmatig kiezen|price|bespar/i)
          checks += 1
        }
      }
    }
  }
  assert.equal(checks, 3600)
})

test('QA paper M3: exact pack-boundary neighbours and incompatible quantities abstain', () => {
  let controls = 0
  for (const [requiredUnit, packUnit] of [
    ['g', 'g'], ['g', 'kg'], ['kg', 'g'], ['ml', 'ml'], ['ml', 'l'], ['l', 'ml'],
  ]) {
    for (const requiredTicks of [3, 7, 11, 23]) {
      for (const packTicks of [2, 4, 7]) {
        const count = 2
        const exactPacks = Math.floor((requiredTicks - 1) / (packTicks * count)) + 1
        const ctx = { requiredTicks, requiredUnit, packTicks, packUnit, count }
        for (const wrong of [Math.max(0, exactPacks - 1), exactPacks + 1]) {
          const row = printOne({ ...ctx, packs: wrong })
          assert.equal(row.needsReview, true, JSON.stringify({ ...ctx, wrong }))
          assert.match(row.quantity, /handmatig kiezen/)
          assert.doesNotMatch(row.quantity, /×/)
          controls += 1
        }
      }
    }
  }
  assert.equal(controls, 144)

  // The exact same numeric magnitudes are *not* interchangeable across
  // mass and volume. A mismatched physical unit can never be printed as bought.
  for (const [requiredUnit, packUnit] of [['g', 'ml'], ['kg', 'l'], ['l', 'g'], ['ml', 'kg']]) {
    const row = printOne({
      requiredTicks: 7, requiredUnit, packTicks: 7, packUnit, count: 1, packs: 1,
    })
    assert.equal(row.needsReview, true)
    assert.match(row.quantity, /handmatig kiezen/)
  }
})
