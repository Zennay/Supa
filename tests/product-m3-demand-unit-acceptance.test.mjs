import assert from 'node:assert/strict'
import test from 'node:test'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'

// Independent 1-demand synthetic acceptance for #1398. Not an observed store price.
function basket(storeId, { amount, unit, packs, priceCents = 10, pack = { amount: 0.01, unit: 'g', count: 1 } }) {
  const line = {
    id: 'controlled-ingredient', ingredientLabel: 'Gecontroleerd ingrediënt',
    requirement: { amount, unit }, status: 'matched',
    productId: storeId + '-product', productName: 'Gecontroleerd product',
    packs, pack, pricePerPackCents: priceCents,
    lineTotalCents: packs * priceCents,
    matchScore: 95, reasons: [],
  }
  const record = {
    store: { id: storeId, name: storeId }, selectedMealCount: 1,
    lines: [line], totalCents: line.lineTotalCents,
    matchedLineCount: 1, unresolvedLineCount: 0,
  }
  Object.freeze(line.requirement)
  Object.freeze(line.pack)
  Object.freeze(line.reasons)
  Object.freeze(line)
  Object.freeze(record.store)
  Object.freeze(record.lines)
  return Object.freeze(record)
}

function pair(baseline, candidate) {
  return {
    baseline: basket('controlled-plus', baseline),
    candidate: basket('controlled-dekamarkt', candidate),
  }
}

function unknown(result) {
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

test('0.07 g and 0.00007 kg are exactly the same tiny seven-pack mass demand', () => {
  const input = pair(
    { amount: 0.07, unit: 'g', packs: 7 },
    { amount: 0.00007, unit: 'kg', packs: 7 },
  )
  const result = compareFullBaskets(input)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.deltaCents, 0)
  assert.equal(result.lineDeltas.length, 1)
  assert.equal(result.lineDeltas[0].deltaCents, 0)
})

test('reverse gram/kilogram representation preserves signed one-cent-per-pack worsening', () => {
  const input = pair(
    { amount: 0.00007, unit: 'kg', packs: 7 },
    { amount: 0.07, unit: 'g', packs: 7, priceCents: 11 },
  )
  const result = compareFullBaskets(input)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, 7)
  assert.equal(result.savingsCents, -7)
  assert.equal(result.lineDeltas[0].deltaCents, 7)
})

test('0.45 l and 450 ml stay equivalent for an exact three-unit multipack', () => {
  const multipack = { amount: 0.15, unit: 'l', count: 3 }
  const input = pair(
    { amount: 0.45, unit: 'l', packs: 1, pack: multipack },
    { amount: 450, unit: 'ml', packs: 1, pack: multipack, priceCents: 9 },
  )
  const result = compareFullBaskets(input)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'better')
  assert.equal(result.deltaCents, -1)
  assert.equal(result.savingsCents, 1)
})

test('genuine 1e-17 g excess cannot be mistaken for equivalent even if pack totals differ', () => {
  const input = pair(
    { amount: 0.07, unit: 'g', packs: 7 },
    { amount: 0.07000000000000001, unit: 'g', packs: 8 },
  )
  unknown(compareFullBaskets(input))
})

test('cross-family mass versus volume is unknown even with identical number', () => {
  const input = pair(
    { amount: 0.07, unit: 'g', packs: 7 },
    { amount: 0.07, unit: 'ml', packs: 7 },
  )
  unknown(compareFullBaskets(input))
})

test('fully identical unit representations remain supported with frozen input', () => {
  const input = pair(
    { amount: 0.07, unit: 'g', packs: 7 },
    { amount: 0.07, unit: 'g', packs: 7 },
  )
  const result = compareFullBaskets(input)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.savingsCents, 0)
})
