import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import { buildObservedComparisonPreview } from '../src/features/comparison/observedStoreComparison.ts'

const NOW = Date.parse('2026-10-15T12:00:00.000Z')

const observe = (candidatePrice = 90) => buildFictionalPricedSheet(candidatePrice)

// Crosscheck against independent canonical CLI implementation instead of
// recomputing the same expected basket using the new UI source.
for (const [candidatePrice, expectedOutcome, expectedSavings] of [
  [0, 'better', 1100],
  [50, 'better', 550],
  [90, 'better', 110],
  [100, 'same', 0],
  [110, 'worse', -110],
  [150, 'worse', -550],
]) {
  test(`independent canonical M3 parity for candidate price ${candidatePrice} cents`, () => {
    const sheet = observe(candidatePrice)
    const sourceBytes = JSON.stringify(sheet)
    const ui = buildObservedComparisonPreview(sheet, NOW)
    const converted = buildWeeklyBasketStudyFromObservationSheet(sheet)
    const canonical = assessWeeklyBasketStudy(converted, { referenceNowMs: NOW })
    const evidence = canonical.comparison
    assert.equal(ui.rows.length, 11)
    assert.equal(ui.plus.complete, true)
    assert.equal(ui.dekamarkt.complete, true)
    assert.equal(ui.plus.knownSubtotalCents, converted.baseline.basket.totalCents)
    assert.equal(ui.dekamarkt.knownSubtotalCents, converted.candidate.basket.totalCents)
    assert.equal(ui.comparable, canonical.claimable, 'UI must not promote an unclaimable M3 study')
    assert.equal(ui.outcome, evidence.outcome)
    assert.equal(ui.outcome, expectedOutcome)
    assert.equal(ui.savingsCents, evidence.savingsCents)
    assert.equal(ui.savingsCents, expectedSavings)
    for (let index = 0; index < 11; index += 1) {
      const rendered = ui.rows[index]
      const realBaseline = converted.baseline.basket.lines[index]
      const realCandidate = converted.candidate.basket.lines[index]
      assert.equal(rendered.id, realBaseline.id)
      assert.equal(rendered.id, realCandidate.id)
      assert.equal(rendered.plus.totalCents, realBaseline.lineTotalCents)
      assert.equal(rendered.dekamarkt.totalCents, realCandidate.lineTotalCents)
      assert.equal(rendered.plus.packs, realBaseline.packs)
      assert.equal(rendered.dekamarkt.packs, realCandidate.packs)
      assert.equal(rendered.differenceCents, realBaseline.lineTotalCents - realCandidate.lineTotalCents)
    }
    assert.equal(JSON.stringify(sheet), sourceBytes, 'local human observations must not change')
  })
}

test('valid observed zero-price rows still count as known prices, not missing values', () => {
  const sheet = observe(0)
  for (const side of ['baseline', 'candidate']) {
    for (const line of sheet[side].lines) line.observedProduct.priceCents = 0
  }
  const ui = buildObservedComparisonPreview(sheet, NOW)
  assert.equal(ui.plus.matched, 11)
  assert.equal(ui.dekamarkt.matched, 11)
  assert.equal(ui.plus.knownSubtotalCents, 0)
  assert.equal(ui.dekamarkt.knownSubtotalCents, 0)
  assert.equal(ui.comparable, true)
  assert.equal(ui.outcome, 'same')
  assert.equal(ui.savingsCents, 0)
  assert.equal(ui.rows.every((row) => row.differenceCents === 0), true)
})

test('every incomplete, unavailable, invalid or untrusted row keeps null item difference and no winner', () => {
  const mutations = [
    ['not observed', (sheet) => { sheet.candidate.lines[0].observedProduct.available = null }, 'missing'],
    ['unavailable', (sheet) => { sheet.candidate.lines[0].observedProduct.available = false }, 'unavailable'],
    ['missing price', (sheet) => { sheet.candidate.lines[0].observedProduct.priceCents = null }, 'missing'],
    ['incompatible unit', (sheet) => { sheet.candidate.lines[0].observedProduct.packUnit = 'piece' }, 'untrusted'],
    ['unsafe money', (sheet) => {
      const product = sheet.candidate.lines[0].observedProduct
      product.priceCents = Number.MAX_SAFE_INTEGER
      product.packAmount = product.packAmount / 2 // two valid packs cause unsafe total
    }, 'untrusted'],
    ['untrusted name', (sheet) => { sheet.candidate.lines[0].observedProduct.productName = 'Entirely unrelated synthetic object' }, 'untrusted'],
  ]
  for (const [label, change, status] of mutations) {
    const sheet = observe()
    const original = JSON.stringify(sheet)
    change(sheet)
    const changedBytes = JSON.stringify(sheet)
    const preview = buildObservedComparisonPreview(sheet, NOW)
    assert.equal(preview.rows[0].dekamarkt.status, status, label)
    assert.equal(preview.rows[0].dekamarkt.totalCents, null, label)
    assert.equal(preview.rows[0].differenceCents, null, label)
    assert.equal(preview.comparable, false, label)
    assert.equal(preview.outcome, 'unknown', label)
    assert.equal(preview.savingsCents, null, label)
    assert.equal(JSON.stringify(sheet), changedBytes, `${label} mutated the original draft`)
    assert.notEqual(JSON.stringify(sheet), original)
  }
})

test('outdated observation from a different price context still cannot become a valid winner', () => {
  const sheet = observe()
  const basetext = JSON.stringify(sheet)
  sheet.study.priceContext = 'online-order'
  sheet.baseline.source = 'receipt'
  sheet.candidate.source = 'consented-export'
  const first = buildObservedComparisonPreview(sheet, NOW)
  assert.equal(first.comparable, true, 'mixed allowed provenance is not forbidden without evidence')
  assert.equal(first.outcome, 'better')
  const second = observe()
  second.candidate.observedAt = '2026-10-15T14:00:00.001Z'
  const invalid = buildObservedComparisonPreview(second, NOW)
  assert.equal(invalid.comparable, false)
  assert.equal(invalid.savingsCents, null)
  assert.ok(invalid.reasons.length > 0)
  assert.equal(JSON.stringify(observe()), basetext)
})

test('a forged extra candidate line cannot award savings from an unequal basket', () => {
  const sheet = observe()
  sheet.candidate.lines.push({
    ...sheet.candidate.lines[0],
    ingredientId: 'injected-basket-item',
  })
  const ui = buildObservedComparisonPreview(sheet, NOW)
  assert.equal(ui.comparable, false)
  assert.equal(ui.outcome, 'unknown')
  assert.equal(ui.savingsCents, null)
})

test('forged planner demand appended to both observed stores cannot create a valid M3 comparison', () => {
  const sheet = observe()
  const first = sheet.requirements[0]
  const extra = { ...first, id: 'synthetic-extra-demand', label: 'Extra fictional demand' }
  sheet.requirements.push(extra)
  for (const side of ['baseline', 'candidate']) {
    const template = sheet[side].lines[0]
    sheet[side].lines.push({
      ...template,
      ingredientId: extra.id,
      ingredientLabel: extra.label,
      requirement: { amount: extra.amount, unit: extra.unit },
    })
  }

  // This is never a canonical 11-line user-week demand.
  assert.throws(
    () => buildWeeklyBasketStudyFromObservationSheet(sheet),
    /canonical|requirement/i,
  )
  const before = JSON.stringify(sheet)
  const ui = buildObservedComparisonPreview(sheet, NOW)
  assert.equal(ui.comparable, false, 'do not accept user-mutated planner demand')
  assert.equal(ui.outcome, 'unknown')
  assert.equal(ui.savingsCents, null)
  assert.equal(JSON.stringify(sheet), before, 'invalid human draft must remain unchanged')
})
