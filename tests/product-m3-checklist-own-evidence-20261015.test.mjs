import test from 'node:test'
import assert from 'node:assert/strict'
import { renderPrivateShoppingChecklists } from '../scripts/retailer-private-shopping-checklist.mjs'

const paid = (price = 129) => ({status:'matched',packs:1,packPriceCents:price,
  totalCents:price,productName:'Fictieve melk',productId:'mock-milk'})
const fixture=()=>({format:'supa-local-snapshot-comparison-v1',comparison:{
  provenance:'offline-snapshot-preview',claimable:false,
  stores:{plus:{complete:true,subtotalCents:129},
    dekamarkt:{complete:true,subtotalCents:119}},
  lines:[{ingredientId:'milk',ingredient:'melk',plus:paid(129),dekamarkt:paid(119)}],
}})
test('M3 checklist retains a valid physical subtotal for ordinary own data',()=>{
  const report=fixture()
  const before=JSON.stringify(report)
  const view=renderPrivateShoppingChecklists(report)
  assert.match(view,/ALLEEN OFFLINE TOTAAL PLUS: €1,29/)
  assert.match(view,/ALLEEN OFFLINE TOTAAL DekaMarkt: €1,19/)
  assert.equal(JSON.stringify(report),before)
})
test('M3 direct inherited paid row is never mistaken for purchased stock',()=>{
  const r=fixture();r.comparison.lines[0].plus=Object.create(paid())
  const view=renderPrivateShoppingChecklists(r)
  assert.match(view,/GEEN BETROUWBAAR VOLLEDIG TOTAAL PLUS/)
  assert.match(view,/ALLEEN OFFLINE TOTAAL DekaMarkt/)
})
test('M3 direct store envelope with inherited subtotal cannot assert complete',()=>{
  const r=fixture();r.comparison.stores.plus=Object.create({complete:true,subtotalCents:129})
  assert.doesNotMatch(renderPrivateShoppingChecklists(r),/ALLEEN OFFLINE TOTAAL PLUS/)
})
test('M3 private getter errors are never executed or leaked',()=>{
  const r=fixture();let reads=0
  Object.defineProperty(r.comparison.lines[0].plus,'productName',{
    get() { reads++;throw new Error('PRIVATE_SHOPPING_SOURCE_SECRET') },
  })
  assert.throws(()=>renderPrivateShoppingChecklists(r),/Invalid or claimable/)
  assert.equal(reads,0)
})
test('M3 proxy trap is rejected before reading status or cents',()=>{
  const r=fixture();let reads=0
  r.comparison.lines[0].plus=new Proxy(paid(),{
    get(target,key) { reads++;return target[key] },
  })
  assert.throws(()=>renderPrivateShoppingChecklists(r),/Invalid or claimable/)
  assert.equal(reads,0)
})
test('M3 sparse row arrays are rejected without a financial total',()=>{
  const r=fixture();r.comparison.lines=new Array(1)
  assert.throws(()=>renderPrivateShoppingChecklists(r),/Invalid or claimable/)
})
