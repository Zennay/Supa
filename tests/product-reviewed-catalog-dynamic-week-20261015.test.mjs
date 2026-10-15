import assert from 'node:assert/strict'
import test from 'node:test'
import { m2InitialPlan, m2Recipes, m2DefaultActiveDays } from '../src/data/m2Fixture.ts'
import { aggregatePlanIngredients } from '../src/domain/basket.ts'
import { buildDynamicReviewedWeek } from '../src/domain/reviewedCatalogPlannedWeek.ts'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'
import { main as reviewCommand } from '../scripts/retailer-reviewed-custom-week.mjs'

const sourceSha = 'b'.repeat(64)
function syntheticCatalog() {
  const products = ['plus', 'dekamarkt'].map(store => ({
    canonicalKey: store + ':local-chicken',
    retailerId: store, retailerProductId: 'local-chicken',
    consistency: 'consistent', sourceRightsVerified: false, publishable: false,
    currentTrustedPriceCents: null, selectedSnapshotSha256: null,
    captures: [{
      name: 'Kippendij',
      currentPriceCents: 12345678, currency: 'EUR',
      capturedAt: '2026-09-15T10:00:00Z',
      snapshotSha256: sourceSha,
      availability: 'available',
      sourceUrl: 'https://www.' + (store === 'plus' ? 'plus.nl' : 'dekamarkt.nl') + '/private-fixture',
      pack: { amount: 400, unit: 'g', rawText: '400 g' },
    }],
  }))
  return {
    schemaVersion: 1, model: 'universal-retailer-product-captures',
    status: 'private-review-only', productionEnabled: false,
    publicSavingsClaimEligible: false,
    productCount: products.length, products,
  }
}
function week(catalog, activeDays, recipes = m2Recipes, plan = m2InitialPlan) {
  return buildDynamicReviewedWeek({ catalog, activeDays, plan, recipes })
}

test('Ma+Do duplicate recipe demand aggregates into five ingredient needs and two retailer review queues', () => {
  const catalog = syntheticCatalog()
  const before = structuredClone(catalog)
  const result = week(catalog,['Ma','Do'])
  assert.deepEqual({
    days:result.activeDayCount, meals:result.selectedMealCount,
    ingredients:result.uniqueIngredientNeeds, rows:result.retailerReviewRows,
  },{ days:2, meals:2, ingredients:5, rows:10 })
  const chicken = result.preview.rows.filter(row=>row.ingredientId==='chicken-thigh')
  assert.equal(chicken.length,2)
  assert.ok(chicken.every(row=>row.required.amount===600 && row.required.unit==='g'))
  assert.ok(chicken.every(row=>row.status==='suggested-for-manual-review'))
  const cauliflower = result.preview.rows.filter(row=>row.ingredientId==='cauliflower')
  assert.equal(cauliflower.length,2)
  assert.ok(cauliflower.every(row=>row.required.amount===2 && row.required.unit==='piece'))
  assert.deepEqual(catalog,before)
  assert.equal(result.livePriceClaimsAllowed,false)
  assert.doesNotMatch(JSON.stringify(result), /12345678|priceCents|private-fixture|sourceUrl/i)
})

test('changing selected days recomputes recipe ingredients, not a fixed 11-line fixture', () => {
  const c = syntheticCatalog()
  const monday = week(c,['Ma'])
  const mondayThursday = week(c,['Ma','Do'])
  const full = week(c,m2DefaultActiveDays)
  assert.equal(monday.uniqueIngredientNeeds,5)
  assert.equal(monday.retailerReviewRows,10)
  assert.equal(mondayThursday.uniqueIngredientNeeds,5)
  assert.equal(full.uniqueIngredientNeeds,11)
  assert.equal(full.retailerReviewRows,22)
  assert.ok(monday.preview.rows.some(row=>row.required.amount===300 && row.ingredientId==='chicken-thigh'))
  assert.ok(mondayThursday.preview.rows.some(row=>row.required.amount===600 && row.ingredientId==='chicken-thigh'))
  assert.equal(full.preview.completeFieldEvidence,false)
})

test('invalid user day subsets, missing recipe, drifted or unknown planner amounts abort', () => {
  const c=syntheticCatalog()
  const invalid=[[],['Ma','Ma'],['Vr'],['Ma',' Ma'],['../Ma'],['Ma','Do','Di','Wo','Za','Zo','Xx','Ly']]
  for(const days of invalid) assert.throws(()=>week(c,days))
  const withoutTikka=m2Recipes.filter(recipe=>recipe.id!=='tikka')
  assert.throws(()=>week(c,['Ma'],withoutTikka), /Missing recipe/)
  const broken=structuredClone(m2Recipes)
  broken[0].ingredients[0].amount=null
  assert.throws(()=>week(c,['Ma'],broken), /missing or unknown ingredient demand/)
  const duplicates=structuredClone(m2InitialPlan)
  duplicates.push({day:'Ma',recipeId:'tikka'})
  assert.throws(()=>week(c,['Ma'],m2Recipes,duplicates), /Ambiguous planned day/)
})

test('six real historical offline adapters generate safe dynamic CLI output for chosen active days', async () => {
  const catalog=buildUniversalRetailerCatalog(await loadReviewedRepositoryFixtures())
  const result=week(catalog,['Ma','Do'])
  assert.equal(result.retailerReviewRows,10)
  const writes=[]
  const twoDay=await reviewCommand(['--days','Ma,Do'],text=>writes.push(text))
  assert.equal(writes.length,1)
  assert.deepEqual(JSON.parse(writes[0]),twoDay)
  assert.deepEqual([twoDay.activeDays,twoDay.selectedMeals,twoDay.uniqueIngredientNeeds,twoDay.retailerReviewRows],[2,2,5,10])
  assert.equal(twoDay.livePricesAvailable,false)
  assert.equal(twoDay.externalRequests,0)
  assert.equal(twoDay.publicSavingsClaimEligible,false)
  assert.doesNotMatch(writes[0], /sourceUrl|capturedAt|productName|priceCents|participantKey|https:|Kippendij/i)
  const all=await reviewCommand([],()=>{})
  assert.equal(all.uniqueIngredientNeeds,11)
  assert.equal(all.retailerReviewRows,22)
  for(const invalid of [['--days','Ma,Ma'],['--days','Vr'],['--days','Ma, Do'],['--output','path'],['--days']]) {
    await assert.rejects(reviewCommand(invalid,()=>{}))
  }
})
