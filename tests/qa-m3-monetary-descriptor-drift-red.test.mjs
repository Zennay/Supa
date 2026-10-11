import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Expected RED on immutable #1451. All products, prices and stores are synthetic.
function make(id, rise = 0) {
  const products = m2Products.map(p => ({
    ...p, id: id + '-' + p.id, storeId: id, priceCents: p.priceCents + rise,
  }))
  products.push({
    id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + rise, available: true,
  })
  const basket = buildOneStoreBasket({
    store: { id, name: id }, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(basket.lines.length, 11)
  assert.equal(basket.matchedLineCount, 11)
  return basket
}

function pair(rise = 0) {
  return { baseline: make('qa-plus'), candidate: make('qa-deka', rise) }
}

function moneyDescriptorProxy(basket, drift) {
  const source = basket.lines[0]
  assert.equal(source.status, 'matched')
  const originalPrice = source.pricePerPackCents
  const originalTotal = source.lineTotalCents
  const packs = source.packs
  const reads = { price: 0, total: 0, get: 0 }
  basket.lines[0] = new Proxy(source, {
    getOwnPropertyDescriptor(target, key) {
      const desc = Reflect.getOwnPropertyDescriptor(target, key)
      if (key === 'pricePerPackCents') {
        reads.price += 1
        if (drift && reads.price >= 2) {
          return { ...desc, value: originalPrice + 1 }
        }
      }
      if (key === 'lineTotalCents') {
        reads.total += 1
        if (drift && reads.total >= 2) {
          return { ...desc, value: originalTotal + packs }
        }
      }
      return desc
    },
    get(target, key, receiver) {
      // The trusted snapshot must not GET money directly from a caller Proxy.
      if (key === 'pricePerPackCents' || key === 'lineTotalCents') {
        reads.get += 1
        throw new Error('unsafe runtime financial GET')
      }
      return Reflect.get(target, key, receiver)
    },
  })
  // A deliberately pre-adjusted root enables the unpatched second-read
  // descriptors to look internally consistent. Preflight sees old row cents.
  if (drift) basket.totalCents += packs
  return reads
}

function assertAbstains(result) {
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

for (const side of ['baseline', 'candidate']) {
  test('M3 ' + side + ' changed own monetary descriptors between preflight and snapshot must abstain [RED]', () => {
    const data = pair()
    const reads = moneyDescriptorProxy(data[side], true)
    assertAbstains(compareFullBaskets(data))
    assert.ok(reads.price >= 2, 'financial descriptor was checked in both phases')
    assert.ok(reads.total >= 2, 'line total descriptor was checked in both phases')
    assert.equal(reads.get, 0)
  })
}

test('stable matched-line money descriptor Proxy retains genuine comparison', () => {
  const data = pair()
  const reads = moneyDescriptorProxy(data.candidate, false)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 11)
  assert.equal(reads.get, 0)
})

test('frozen eleven-demand pair and controlled +1 cent per physical pack remain exact', () => {
  const data = pair()
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  const same = compareFullBaskets(data)
  assert.equal(same.claimable, true)
  assert.equal(same.outcome, 'same')
  assert.equal(same.savingsCents, 0)
  const more = pair(1)
  const packCount = more.baseline.lines.reduce((n, line) => n + line.packs, 0)
  const worse = compareFullBaskets(more)
  assert.equal(worse.claimable, true)
  assert.equal(worse.outcome, 'worse')
  assert.equal(worse.deltaCents, packCount)
  assert.equal(worse.savingsCents, -packCount)
})
