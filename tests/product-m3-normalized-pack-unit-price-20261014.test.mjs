import assert from 'node:assert/strict'
import test from 'node:test'

import { privateM3PackUnitPrice } from '../scripts/m3-private-pack-unit-price.mjs'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ProductComparisonHtml } from '../scripts/m3-private-comparison-html.mjs'

function product(overrides = {}) {
  return {
    status: 'known',
    pricePerPackageCents: 800,
    packAmount: 500,
    packUnit: 'g',
    itemsPerPackage: 2,
    ...overrides,
  }
}

test('private unit guidance treats twin 500g packs as one kilogram and exact 80c per 100g', () => {
  assert.deepEqual(privateM3PackUnitPrice(product()), {
    cents: 80, basis: '100 g', approximate: false,
  })
  assert.deepEqual(privateM3PackUnitPrice(product({
    packAmount: 0.5, packUnit: 'kg',
  })), { cents: 80, basis: '100 g', approximate: false })
})

test('private unit guidance normalizes 750 ml and 0.75 liter equally, rounding only display cents', () => {
  for (const [packAmount, packUnit] of [[750, 'ml'], [0.75, 'l']]) {
    assert.deepEqual(privateM3PackUnitPrice(product({
      packAmount, packUnit, pricePerPackageCents: 800, itemsPerPackage: 1,
    })), { cents: 107, basis: '100 ml', approximate: true })
  }
})

test('price per physical piece uses pack count and never pretends it is per 100 pieces', () => {
  assert.deepEqual(privateM3PackUnitPrice(product({
    packUnit: 'piece', packAmount: 4, itemsPerPackage: 2,
  })), { cents: 100, basis: 'stuk', approximate: false })
})

test('unit price is explicitly unavailable for missing or unsupported/unsafe pack metadata', () => {
  for (const override of [
    { status: 'unresolved' }, { packUnit: 'unknown' }, { packUnit: '__proto__' },
    { packUnit: 'constructor' }, { itemsPerPackage: 0 }, { itemsPerPackage: 1.3 },
    { packAmount: 0 }, { packAmount: Number.POSITIVE_INFINITY },
    { packAmount: 1e-300 }, { packUnit: null }, { pricePerPackageCents: -1 },
    { pricePerPackageCents: Number.MAX_SAFE_INTEGER + 1 },
  ]) assert.equal(privateM3PackUnitPrice(product(override)), null, JSON.stringify(override))
})

test('HTML includes contextual indicative per 100g only, basket winner stays based on actual packs', () => {
  const sheet = buildFictionalPricedSheet(90)
  sheet.baseline.lines[0].observedProduct.packAmount = 0.5
  sheet.baseline.lines[0].observedProduct.packUnit = 'kg'
  sheet.baseline.lines[0].observedProduct.packCount = 2
  sheet.candidate.lines[0].observedProduct.packAmount = 500
  sheet.candidate.lines[0].observedProduct.packUnit = 'g'
  sheet.candidate.lines[0].observedProduct.packCount = 2
  const report = buildPrivateM3ProductComparison(sheet)
  const html = renderPrivateM3ProductComparisonHtml(report)
  assert.match(html, /\/ 100 g/)
  assert.match(html, /Indicatie:/)
  assert.match(html, /Niet onafhankelijk geverifieerd/)
  assert.equal(report.fullBasket.outcome, 'better')
  assert.equal(report.fullBasket.provisionalSavingsCents, 110)
  assert.equal(report.publicSavingsClaimEligible, false)
})

test('HTML missing product never displays invented unit price', () => {
  const sheet = buildFictionalPricedSheet(90)
  sheet.candidate.lines[0].observedProduct.available = false
  const report = buildPrivateM3ProductComparison(sheet)
  const html = renderPrivateM3ProductComparisonHtml(report)
  assert.match(html, /Niet betrouwbaar geprijsd/)
  assert.match(html, /Nog geen betrouwbare winnaar/)
  assert.equal(report.fullBasket.provisionalSavingsCents, null)
})

test('unit display rounding never changes actual precise full-basket cents', () => {
  const report = buildPrivateM3ProductComparison(buildFictionalPricedSheet(90))
  const before = JSON.stringify(report)
  const html = renderPrivateM3ProductComparisonHtml(report)
  assert.match(html, /\/ 100/)
  assert.equal(JSON.stringify(report), before)
  assert.equal(report.fullBasket.plusTotalCents, 1100)
  assert.equal(report.fullBasket.dekamarktTotalCents, 990)
})
