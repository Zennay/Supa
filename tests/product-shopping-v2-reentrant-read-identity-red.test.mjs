import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListProgressV2StorageKey as v2Key } from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'

// Independent synthetic interleaving for #1564, on frozen postrepair #1693.
// A custom synchronous storage port can change a caller-owned basket when the
// controller re-reads persisted v2. This does not assert native localStorage CAS.
function currentBasket() {
  return buildOneStoreBasket({
    store: m2Store, products: m2Products, recipes: m2Recipes,
    plan: m2InitialPlan, activeDays: ['Di'],
  })
}

function interleavedPort(onPersistRead) {
  const data = new Map()
  const writes = []
  let reads = 0
  return {
    data, writes,
    getItem(key) {
      assert.equal(key, v2Key, 'no legacy v1 fallback')
      reads++
      if (reads === 2) onPersistRead()
      return data.get(key) ?? null
    },
    setItem(key, value) {
      writes.push([key, value])
      data.set(key, value)
    },
  }
}

for (const [label, mutate] of [
  ['store identity changes', (basket) => { basket.store = { ...basket.store, id: 'fictional-other-store' } }],
  ['selected physical pack count changes', (basket) => {
    const row = basket.lines.find((line) => line.status === 'matched')
    assert.ok(row)
    row.pack.count += 1
  }],
]) {
  test('Product #1564 expected RED: refuse stale shopping-v2 save when ' + label + ' during storage read', () => {
    const basket = currentBasket()
    const disk = interleavedPort(() => mutate(basket))
    const controller = openShoppingProgressStorageV2(basket, disk)
    const line = basket.lines.find((row) => row.status === 'matched')
    assert.ok(line)
    controller.toggle(line.id)
    const before = controller.snapshot().demandIdentity
    assert.notEqual(before, null)

    assert.equal(controller.persist(), false, 'do not write the pre-read physical shopping task')
    assert.notEqual(shoppingListDemandIdentity(basket), before)
    assert.deepEqual(disk.writes, [], 'no stale checkmarks reach durable storage')
    assert.equal(disk.data.get(v2Key), undefined)
    assert.deepEqual(controller.snapshot().completedLineIds, [line.id], 'failed write preserves local tick')
  })
}

test('Product #1564 control: price-only change during durable read keeps legitimate ticks', () => {
  const basket = currentBasket()
  const disk = interleavedPort(() => {
    const row = basket.lines.find((line) => line.status === 'matched')
    assert.ok(row)
    row.pricePerPackCents += 1
    row.lineTotalCents += row.packs
    basket.totalCents += row.packs
  })
  const controller = openShoppingProgressStorageV2(basket, disk)
  const row = basket.lines.find((line) => line.status === 'matched')
  assert.ok(row)
  controller.toggle(row.id)
  const before = controller.snapshot().demandIdentity
  assert.equal(controller.persist(), true, 'physical shopping task is unchanged')
  assert.equal(shoppingListDemandIdentity(basket), before)
  assert.equal(disk.writes.length, 1)
  assert.deepEqual(
    openShoppingProgressStorageV2(basket, {
      getItem(key) { return disk.data.get(key) ?? null },
      setItem() { throw Error('read-only control') },
    }).snapshot().completedLineIds,
    [row.id],
  )
})
