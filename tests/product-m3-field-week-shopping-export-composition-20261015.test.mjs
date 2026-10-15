import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { m3StudyWeekAlignment } from '../scripts/m3-field-plan-alignment.mjs'
import { selectedFixtureWeek } from '../scripts/retailer-reviewed-custom-week.mjs'
import { preparePrintableShoppingChecklist } from '../src/features/shopping-list/printableShoppingChecklist.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'

function makeBasket(plan = m2InitialPlan, activeDays = m2DefaultActiveDays) {
  return structuredClone(buildOneStoreBasket({
    store: m2Store, plan, activeDays, recipes: m2Recipes, products: m2Products,
  }))
}

test('combined product: canonical field-week preflight and physical paper/copy stay compatible without price/evidence claims', () => {
  const preflight = m3StudyWeekAlignment()
  assert.equal(preflight.matchesFixedWorksheetDemand, true)
  assert.equal(preflight.retailerReusePermissionVerified, false)
  assert.equal(preflight.fieldObservationEvidenceCollected, false)
  assert.equal(preflight.publicSavingsClaimEligible, false)
  assert.equal(preflight.liveRetailerRequests, 0)

  const basket = makeBasket()
  const unchanged = structuredClone(basket)
  const printable = preparePrintableShoppingChecklist(basket)
  const copied = buildShoppingListCopyText(basket)
  assert.equal(printable.lines.length, basket.lines.length)
  assert.equal(typeof copied, 'string')
  assert.equal((copied.match(/\n\[.\] /g) ?? []).length, basket.lines.length)
  assert.doesNotMatch(JSON.stringify(printable) + copied, /priceCents|lineTotalCents|savingsCents|observedAt|publicSavingsClaimEligible/)
  assert.deepEqual(basket, unchanged)
})

test('combined product: legitimate alternate demo recipes retain honest personal shopping export, not fixed 11x2 research eligibility', () => {
  const args = ['--plan', 'Ma:pasta,Di:teriyaki,Wo:pasta,Do:tikka']
  const selected = selectedFixtureWeek(args)
  const preflight = m3StudyWeekAlignment(args)
  assert.equal(preflight.matchesFixedWorksheetDemand, false)
  assert.equal(preflight.publicSavingsClaimEligible, false)
  assert.equal(preflight.fieldObservationEvidenceCollected, false)
  assert.deepEqual(preflight.changedRecipes.map(row => row.day), ['Ma'])

  const basket = makeBasket(selected.plan, selected.days)
  const paper = preparePrintableShoppingChecklist(basket)
  const copy = buildShoppingListCopyText(basket)
  assert.equal(paper.lines.length, basket.lines.length)
  assert.equal(typeof copy, 'string')
  assert.doesNotMatch(JSON.stringify(paper) + copy, /pricePerPackCents|lineTotalCents|savingsCents/)
})

test('combined product: custom partial week can still generate a truthful shopping list but must not reuse the frozen M3 sheet', () => {
  const args = ['--days', 'Ma,Do']
  const selected = selectedFixtureWeek(args)
  const preflight = m3StudyWeekAlignment(args)
  assert.equal(preflight.matchesFixedWorksheetDemand, false)
  assert.deepEqual(preflight.missingDays, ['Di', 'Wo'])
  assert.equal(preflight.retailerReusePermissionVerified, false)

  const basket = makeBasket(selected.plan, selected.days)
  const paper = preparePrintableShoppingChecklist(basket)
  const copy = buildShoppingListCopyText(basket)
  assert.equal(paper.lines.length, basket.lines.length)
  assert.equal(typeof copy, 'string')
  assert.match(copy, /Eigen planning/)
  assert.equal(preflight.publicSavingsClaimEligible, false)
})

test('combined product: hostile shopping fact cannot become printed price or change M3 field preflight status', () => {
  const basket = makeBasket()
  const matched = basket.lines.find(row => row.status === 'matched')
  assert.ok(matched)
  let getterCalls = 0
  Object.defineProperty(matched, 'productName', {
    configurable: true,
    get() { getterCalls++; throw new Error('PRIVATE-M3-OBSERVATION-NOTE') },
  })
  const paper = preparePrintableShoppingChecklist(basket)
  const affected = paper.lines.find(line => line.id === matched.id)
  assert.ok(affected)
  assert.equal(affected.needsReview, true)
  assert.match(affected.quantity, /handmatig kiezen/)
  assert.equal(buildShoppingListCopyText(basket), null)
  assert.equal(getterCalls, 0)
  assert.equal(m3StudyWeekAlignment().fieldObservationEvidenceCollected, false)
})
