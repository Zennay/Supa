import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'
import { preparePrintableShoppingChecklist } from '../src/features/shopping-list/printableShoppingChecklist.ts'

// Independent finite integer-tenths oracle; deliberately does NOT reuse the
// product implementation's decimal-to-BigInt conversion or quantity division.
const fixture = buildOneStoreBasket({
  store: m2Store,
  plan: m2InitialPlan,
  recipes: m2Recipes,
  activeDays: m2DefaultActiveDays,
  products: m2Products,
})
assert.ok(fixture.lines.some((line) => line.status === 'matched'))

function trial({
  requiredAmount,
  requiredUnit,
  packAmount,
  packUnit,
  packCount,
  outerPacks,
}) {
  const basket = structuredClone(fixture)
  const target = basket.lines.find((line) => line.status === 'matched')
  assert.ok(target)
  target.requirement = { amount: requiredAmount, unit: requiredUnit }
  target.pack = { amount: packAmount, unit: packUnit, count: packCount }
  target.packs = outerPacks
  const before = structuredClone(basket)
  const printable = preparePrintableShoppingChecklist(basket)
  assert.deepEqual(basket, before, 'print conversion must not mutate source')
  assert.equal(printable.lines.length, basket.lines.length)
  assert.deepEqual(printable.lines.map(({ id }) => id), basket.lines.map(({ id }) => id))
  const output = printable.lines.find((line) => line.id === target.id)
  assert.ok(output)
  assert.equal(printable.reviewCount, printable.lines.filter((line) => line.needsReview).length)
  assert.equal(printable.isDemo, true)
  assert.doesNotMatch(
    JSON.stringify(printable),
    /"totalCents"|"priceCents"|"lineTotalCents"|"savingsCents"|"participantKey"/,
  )
  return output
}

const quantities = [1, 2, 3, 7, 10, 17, 30, 33, 75, 90, 100, 201, 300, 601]
const packTenths = [1, 2, 3, 5, 7, 10, 15, 20, 25, 33, 50, 75, 100]
const counts = [1, 2, 5]

test('independent integer-tenths oracle: fractional cross-unit g/kg and ml/l exact pack minima', () => {
  let checked = 0
  for (const [small, large] of [['g', 'kg'], ['ml', 'l']]) {
    for (const needed of quantities) {
      for (const perItemTenths of packTenths) {
        for (const count of counts) {
          const capacityTenths = perItemTenths * count
          const exactMinimum = Math.floor((needed * 10 + capacityTenths - 1) / capacityTenths)
          assert.ok(exactMinimum >= 1)
          // Independent oracle is whole integer tenths; product uses decimal
          // BigInt cross-multiplication and may not use this test's formula.
          for (const requiredUnit of [small, large]) {
            for (const packUnit of [small, large]) {
              const requiredAmount = requiredUnit === small ? needed : needed / 1000
              const packAmount = packUnit === small
                ? perItemTenths / 10 : perItemTenths / 10_000
              const input = { requiredAmount, requiredUnit, packAmount, packUnit, packCount: count }
              const correct = trial({ ...input, outerPacks: exactMinimum })
              assert.equal(correct.needsReview, false,
                `valid minimum ${needed}${small} / ${perItemTenths}/10${small} x ${count}`)

              const excessive = trial({ ...input, outerPacks: exactMinimum + 1 })
              assert.equal(excessive.needsReview, true, 'excess outer pack must be manually checked')
              assert.match(excessive.quantity, /handmatig kiezen/)
              if (exactMinimum > 1) {
                const insufficient = trial({ ...input, outerPacks: exactMinimum - 1 })
                assert.equal(insufficient.needsReview, true, 'missing outer pack must be manually checked')
              }
              checked += 1
            }
          }
        }
      }
    }
  }
  assert.equal(checked, 2 * quantities.length * packTenths.length * counts.length * 4)
})

test('piece count oracle keeps canonical piece unit labels and rejects fractional physical packs', () => {
  for (const needed of [1, 2, 3, 5, 7, 11, 29, 100]) {
    for (const perPack of [1, 2, 3, 5, 11]) {
      for (const count of [1, 2, 4]) {
        const packs = Math.floor((needed + perPack * count - 1) / (perPack * count))
        const input = {
          requiredAmount: needed,
          requiredUnit: 'piece',
          packAmount: perPack,
          packUnit: 'piece',
          packCount: count,
        }
        const correct = trial({ ...input, outerPacks: packs })
        assert.equal(correct.needsReview, false)
        assert.doesNotMatch(correct.quantity, /\bpiece\b|handmatig kiezen/)
        assert.match(correct.quantity, /\bstuk\b|\bstuks\b/)
        const extra = trial({ ...input, outerPacks: packs + 1 })
        assert.equal(extra.needsReview, true)
      }
    }
  }
})

test('cross-family unit mismatches never become trusted physical purchase instructions', () => {
  for (const pair of [
    ['g', 'ml'], ['kg', 'l'], ['ml', 'g'], ['l', 'kg'],
    ['piece', 'kg'], ['g', 'piece'], ['piece', 'ml'],
  ]) {
    const printed = trial({
      requiredAmount: 300, requiredUnit: pair[0], packAmount: 100,
      packUnit: pair[1], packCount: 1, outerPacks: 3,
    })
    assert.equal(printed.needsReview, true)
    assert.match(printed.quantity, /handmatig kiezen/)
  }
})

test('price-only changes never affect paper purchase instructions or confidence', () => {
  const first = structuredClone(fixture)
  const second = structuredClone(fixture)
  for (const line of second.lines) {
    if (line.status === 'matched') {
      line.pricePerPackCents = 2_000_000_001
      line.lineTotalCents = 8_000_000_001
    }
  }
  second.totalCents = 123_456_789
  assert.deepEqual(preparePrintableShoppingChecklist(first),
    preparePrintableShoppingChecklist(second))
})
