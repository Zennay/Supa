import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Independent POSTREPAIR tests; no production or real retailer observation.
function make(storeId, increment = 0) {
  const products = m2Products.map(p => ({
    ...p, id: storeId + '-' + p.id, storeId,
    priceCents: p.priceCents + increment,
  }))
  products.push({ id: storeId + '-garam', storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + increment, available: true })
  const basket = buildOneStoreBasket({ store: { id: storeId, name: storeId },
    plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products })
  assert.equal(basket.lines.length, 11)
  assert.equal(basket.matchedLineCount, 11)
  return basket
}
const pair = (increase = 0) => ({
  baseline: make('qa-plus'), candidate: make('qa-deka', increase),
})
function unknown(result) {
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}
function patch(line, path, value) {
  if (path.includes('.')) {
    const [parent, key] = path.split('.')
    line[parent][key] = value
  } else line[path] = value
}

test('postrepair unusual boxed/BigInt/symbol/string numbers abstain on both stores', () => {
  const cases = [
    ['pricePerPackCents', new Number(249)],
    ['pack.amount', 500n],
    ['pack.count', Symbol('2')],
    ['packs', '2'],
    ['lineTotalCents', true],
    ['requirement.amount', { value: 50 }],
    ['matchScore', Object(100)],
  ]
  for (const [field, value] of cases) {
    for (const side of ['baseline', 'candidate']) {
      const data = pair()
      patch(data[side].lines[0], field, value)
      unknown(compareFullBaskets(data))
    }
  }
})

test('postrepair poisoned numeric conversion callbacks never run through arithmetic', () => {
  const fields = [
    'pack.amount', 'pack.count', 'packs', 'pricePerPackCents',
    'lineTotalCents', 'requirement.amount', 'matchScore',
  ]
  for (const field of fields) {
    const calls = []
    const deceptive = {
      [Symbol.toPrimitive](hint) {
        calls.push(field + ':' + hint)
        throw Error('unexpected implicit numeric conversion')
      },
    }
    const data = pair()
    patch(data.candidate.lines[8], field, deceptive)
    unknown(compareFullBaskets(data))
    assert.deepEqual(calls, [], field)
  }
})

test('postrepair malformed money does not contaminate another legitimate basket', () => {
  const data = pair(1)
  const calls = []
  data.candidate.lines[2].lineTotalCents = {
    valueOf() { calls.push('valueOf'); return 0 },
  }
  const result = compareFullBaskets(data)
  unknown(result)
  assert.deepEqual(calls, [])
})

test('postrepair matched line own descriptor getter still abstains without invocation', () => {
  const data = pair()
  let reads = 0
  Object.defineProperty(data.candidate.lines[7], 'pricePerPackCents', {
    configurable: true, get() { reads++; return 99 },
  })
  unknown(compareFullBaskets(data))
  assert.equal(reads, 0)
})

test('postrepair frozen control stays same with exact 11 matched needs', () => {
  const data = pair()
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.deltaCents, 0)
  assert.equal(result.lineDeltas.length, 11)
})

test('postrepair +1-cent per physical pack must remain worse with exact cents', () => {
  const data = pair(1)
  const packs = data.baseline.lines.reduce((s, line) => s + line.packs, 0)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, packs)
  assert.equal(result.savingsCents, -packs)
})
