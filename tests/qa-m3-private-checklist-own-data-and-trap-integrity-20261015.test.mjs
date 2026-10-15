import assert from 'node:assert/strict'
import test from 'node:test'
import { renderPrivateShoppingChecklists } from '../scripts/retailer-private-shopping-checklist.mjs'

// All rows, prices, timestamps and names below are entirely fictional.
// Scope: independently test the direct exported private formatter on the
// product-owned feature PR, without modifying the formatter or using HTTP.
const paid = (cents, id='fictional-milk') => ({
  status: 'matched', packs: 1, packPriceCents: cents, totalCents: cents,
  productId: id, productName: 'Fictieve melk',
})
function fixture() {
  return {
    format: 'supa-local-snapshot-comparison-v1',
    comparison: {
      provenance: 'offline-snapshot-preview', claimable: false,
      stores: {
        plus: { complete: true, subtotalCents: 129 },
        dekamarkt: { complete: true, subtotalCents: 119 },
      },
      lines: [{
        ingredientId: 'milk', ingredient: 'melk',
        plus: paid(129), dekamarkt: paid(119),
      }],
    },
  }
}
const hasTotal = (out, shop) =>
  out.includes('ALLEEN OFFLINE TOTAAL ' + shop + ': €')

test('control: ordinary own-data fictional report prints both offline store totals', () => {
  const text = renderPrivateShoppingChecklists(fixture())
  assert.ok(hasTotal(text, 'PLUS'))
  assert.ok(hasTotal(text, 'DekaMarkt'))
  assert.match(text, /GEEN LIVE PRIJS/u)
})

test('control: absent DekaMarkt stock cannot suppress independently complete PLUS', () => {
  const data = fixture()
  data.comparison.lines[0].dekamarkt.status = 'availability_unknown'
  const text = renderPrivateShoppingChecklists(data)
  assert.ok(hasTotal(text, 'PLUS'))
  assert.equal(hasTotal(text, 'DekaMarkt'), false)
})

test('inherited matched row data cannot certify a paid physical item', () => {
  const data = fixture()
  data.comparison.lines[0].plus = Object.create(paid(129))
  const text = renderPrivateShoppingChecklists(data)
  assert.equal(hasTotal(text, 'PLUS'), false,
    'Prototype-inherited price/status/pack fields must never create a trusted total')
})

test('inherited root store complete and subtotal cannot certify a full basket', () => {
  const data = fixture()
  data.comparison.stores.plus = Object.create({complete:true,subtotalCents:129})
  const text = renderPrivateShoppingChecklists(data)
  assert.equal(hasTotal(text, 'PLUS'), false,
    'Untrusted store subtotal and completeness need own data provenance')
})

test('inherited shared-pack coverage cannot turn unpaid demand into covered demand', () => {
  const data = fixture()
  const owner = Object.assign(
    Object.create({sharedPackCoversIngredientIds:['milk','second']}),
    paid(129),
  )
  data.comparison.lines[0].plus = owner
  data.comparison.lines.push({
    ingredientId:'second', ingredient:'tweede fictieve melk',
    plus: { ...paid(129), packs:0, totalCents:0,
      sharedPackWithIngredientId:'milk' },
    dekamarkt: { ...paid(119,'second-product'), packs:0, totalCents:0,
      sharedPackWithIngredientId:'missing-owner' },
  })
  const text = renderPrivateShoppingChecklists(data)
  assert.equal(hasTotal(text, 'PLUS'), false,
    'Coverage cannot be proved by properties inherited from a caller-controlled prototype')
})

test('inherited shared-pack parent id cannot establish a paid owner', () => {
  const data = fixture()
  data.comparison.lines[0] = Object.assign(
    Object.create({ingredientId:'milk'}),
    {ingredient:'melk', plus:{...paid(129),
      sharedPackCoversIngredientIds:['milk','second']}, dekamarkt:paid(119)},
  )
  data.comparison.lines.push({
    ingredientId:'second', ingredient:'extra melk',
    plus:{...paid(129),packs:0,totalCents:0,sharedPackWithIngredientId:'milk'},
    dekamarkt:{...paid(119,'second'),packs:0,totalCents:0,
      sharedPackWithIngredientId:'ghost'},
  })
  const text = renderPrivateShoppingChecklists(data)
  assert.equal(hasTotal(text, 'PLUS'), false,
    'Inherited identity is not independently observed source ownership')
})

test('malicious product label getter never leaks its error payload or succeeds', () => {
  const data = fixture()
  Object.defineProperty(data.comparison.lines[0].plus, 'productName', {
    get() { throw new Error('PRIVATE-LOCAL-SOURCE-TOKEN-DO-NOT-PRINT') },
  })
  let text = ''
  try { text = renderPrivateShoppingChecklists(data) }
  catch (error) {
    assert.doesNotMatch(String(error), /PRIVATE-LOCAL-SOURCE-TOKEN/u)
    return
  }
  assert.equal(hasTotal(text,'PLUS'), false)
  assert.doesNotMatch(text, /PRIVATE-LOCAL-SOURCE-TOKEN/u)
})

test('malicious row Proxy never gets a property-read trap while authenticating', () => {
  const data = fixture()
  let accesses = 0
  data.comparison.lines[0].plus = new Proxy(paid(129), {
    get(target, prop, receiver) {
      accesses += 1
      return Reflect.get(target, prop, receiver)
    },
  })
  let text = ''
  try { text = renderPrivateShoppingChecklists(data) }
  catch (error) { assert.doesNotMatch(String(error), /PRIVATE-LOCAL/u) }
  assert.equal(accesses, 0, 'A Proxy must be rejected before its getters execute')
  assert.equal(hasTotal(text,'PLUS'), false)
})

test('a getter-backed shared coverage list cannot execute a private user callback', () => {
  const data = fixture()
  let invoked = 0
  Object.defineProperty(data.comparison.lines[0].plus,
    'sharedPackCoversIngredientIds', { get() { invoked++; return ['milk','second'] } })
  data.comparison.lines.push({
    ingredientId:'second', ingredient:'extra melk',
    plus:{...paid(129),packs:0,totalCents:0,sharedPackWithIngredientId:'milk'},
    dekamarkt:{...paid(119,'other'),packs:0,totalCents:0,
      sharedPackWithIngredientId:'ghost'},
  })
  let text = ''
  try { text = renderPrivateShoppingChecklists(data) }
  catch (error) { assert.doesNotMatch(String(error), /PRIVATE-LOCAL/u) }
  assert.equal(invoked, 0, 'No untrusted accessors for shared-purchase proof')
  assert.equal(hasTotal(text,'PLUS'), false)
})
