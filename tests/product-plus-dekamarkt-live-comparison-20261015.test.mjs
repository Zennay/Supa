import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildObservedComparisonPreview } from '../src/features/comparison/observedStoreComparison.ts'

const NOW = Date.parse('2026-10-15T12:00:00Z')

test('actual observed same-demand 11+11 prices produce an explainable DekaMarkt comparison', () => {
  const sheet = buildFictionalPricedSheet(90)
  const original = JSON.stringify(sheet)
  const comparison = buildObservedComparisonPreview(sheet, NOW)
  assert.equal(comparison.rows.length, 11)
  assert.equal(comparison.plus.matched, 11)
  assert.equal(comparison.dekamarkt.matched, 11)
  assert.equal(comparison.plus.knownSubtotalCents, 1100)
  assert.equal(comparison.dekamarkt.knownSubtotalCents, 990)
  assert.equal(comparison.outcome, 'better')
  assert.equal(comparison.savingsCents, 110)
  assert.equal(comparison.comparable, true)
  assert.equal(comparison.rows.every((row) =>
    row.plus.status === 'priced' && row.dekamarkt.status === 'priced'), true)
  assert.equal(JSON.stringify(sheet), original, 'comparison must not modify stored field evidence')
})

for (const [price, outcome, savings] of [
  [100, 'same', 0],
  [110, 'worse', -110],
]) {
  test(`complete observed basket permits truthful ${outcome} result`, () => {
    const sheet = buildFictionalPricedSheet(price)
    const comparison = buildObservedComparisonPreview(sheet, NOW)
    assert.equal(comparison.outcome, outcome)
    assert.equal(comparison.savingsCents, savings)
    assert.equal(comparison.comparable, true)
  })
}

test('missing prices show known subtotal but never manufacture full basket savings', () => {
  const sheet = buildFictionalPricedSheet(90)
  sheet.candidate.lines[0].observedProduct.priceCents = null
  const comparison = buildObservedComparisonPreview(sheet, NOW)
  assert.equal(comparison.dekamarkt.matched, 10)
  assert.equal(comparison.dekamarkt.knownSubtotalCents, 900)
  assert.equal(comparison.dekamarkt.complete, false)
  assert.equal(comparison.rows[0].dekamarkt.status, 'missing')
  assert.equal(comparison.outcome, 'unknown')
  assert.equal(comparison.savingsCents, null)
  assert.equal(comparison.comparable, false)
})

test('observed unavailable ingredients do not become imaginary zero-priced products', () => {
  const sheet = buildFictionalPricedSheet(90)
  sheet.baseline.lines[0].observedProduct.available = false
  sheet.baseline.lines[0].observedProduct.priceCents = 900000
  const comparison = buildObservedComparisonPreview(sheet, NOW)
  assert.equal(comparison.rows[0].plus.status, 'unavailable')
  assert.equal(comparison.plus.knownSubtotalCents, 1000)
  assert.equal(comparison.outcome, 'unknown')
  assert.equal(comparison.savingsCents, null)
})

test('real canonical decimal pack arithmetic powers row and total comparison', () => {
  const sheet = buildFictionalPricedSheet(90)
  const index = sheet.requirements.findIndex((line) => line.amount === 450 && line.unit === 'g')
  assert.notEqual(index, -1)
  sheet.baseline.lines[index].observedProduct.packAmount = 0.144
  sheet.baseline.lines[index].observedProduct.packUnit = 'g'
  sheet.candidate.lines[index].observedProduct.packAmount = 0.000072
  sheet.candidate.lines[index].observedProduct.packUnit = 'kg'
  sheet.candidate.lines[index].observedProduct.packCount = 2
  const comparison = buildObservedComparisonPreview(sheet, NOW)
  assert.equal(comparison.rows[index].plus.packs, 3125)
  assert.equal(comparison.rows[index].dekamarkt.packs, 3125)
  assert.equal(comparison.plus.knownSubtotalCents, 313500)
  assert.equal(comparison.dekamarkt.knownSubtotalCents, 282150)
  assert.equal(comparison.savingsCents, 31350)
  assert.equal(comparison.comparable, true)
})

test('out of window, future capture or wrong retailer cannot be called a real comparison', () => {
  for (const mutation of [
    (sheet) => { sheet.candidate.observedAt = '2026-10-03T13:00:00Z' },
    (sheet) => { sheet.candidate.observedAt = '2026-10-20T13:00:00Z' },
    (sheet) => { sheet.candidate.store.name = 'Andere winkel' },
    (sheet) => { sheet.candidate.evidenceId = sheet.baseline.evidenceId },
    (sheet) => { sheet.candidate.source = 'browser-cache' },
    (sheet) => { sheet.study.weekStart = '2026-09-01' },
  ]) {
    const sheet = buildFictionalPricedSheet(90)
    mutation(sheet)
    const comparison = buildObservedComparisonPreview(sheet, NOW)
    assert.equal(comparison.comparable, false)
    assert.equal(comparison.outcome, 'unknown')
    assert.equal(comparison.savingsCents, null)
    assert.ok(comparison.reasons.length > 0)
  }
})

test('untrusted product matching, overflow line and accumulated overflow never produce a winner', () => {
  for (const mutation of [
    (sheet) => { sheet.baseline.lines[0].observedProduct.productName = 'Totaal ongerelateerd item' },
    (sheet) => {
      const product = sheet.baseline.lines[0].observedProduct
      product.priceCents = Number.MAX_SAFE_INTEGER
      product.packAmount = product.packAmount / 2
    },
    (sheet) => {
      sheet.baseline.lines[0].observedProduct.priceCents = Number.MAX_SAFE_INTEGER - 1
      sheet.baseline.lines[1].observedProduct.priceCents = Number.MAX_SAFE_INTEGER - 1
    },
  ]) {
    const sheet = buildFictionalPricedSheet(90)
    mutation(sheet)
    const comparison = buildObservedComparisonPreview(sheet, NOW)
    assert.equal(comparison.comparable, false)
    assert.equal(comparison.savingsCents, null)
  }
})

test('fresh empty human field sheet displays no invented prices', async () => {
  const { buildObservationSheet } = await import('../src/domain/m3ObservationSheet.ts')
  const comparison = buildObservedComparisonPreview(buildObservationSheet(), NOW)
  assert.equal(comparison.plus.knownSubtotalCents, null)
  assert.equal(comparison.dekamarkt.knownSubtotalCents, null)
  assert.equal(comparison.plus.matched, 0)
  assert.equal(comparison.dekamarkt.matched, 0)
  assert.equal(comparison.outcome, 'unknown')
  assert.equal(comparison.rows.length, 11)
})
