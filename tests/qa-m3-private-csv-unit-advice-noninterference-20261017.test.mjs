import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'
import { privateM3PackUnitPrice } from '../scripts/m3-private-pack-unit-price.mjs'

// QA only: synthetic 11x2 packs; private display advice cannot become basket money.
const fixture = () => {
  const r = buildPrivateM3ProductComparison(buildFictionalPricedSheet(90))
  assert.equal(r.lines.length, 11)
  assert.equal(r.fullBasket.comparable, true)
  assert.equal(r.publicSavingsClaimEligible, false)
  return r
}
const money = cents => {
  const n = Math.abs(cents)
  return (cents < 0 ? '-' : '') + Math.floor(n / 100) + ',' + String(n % 100).padStart(2, '0')
}
const parse = csv => csv.replace(/^\ufeff/u, '').trimEnd().split('\r\n')
  .map(line => line.split(';').map(s => s.slice(1, -1)))

test('M3: all 22 synthetic whole-pack money lines equal the private 19-column CSV', () => {
  const r = fixture()
  const csv = renderPrivateM3ComparisonCsv(r)
  const rows = parse(csv)
  assert.equal(rows.length, 14)
  assert.match(csv, /PRIVE \/ NIET GEVERIFIEERD/u)
  assert.equal(rows[1].length, 19)
  let plus = 0, deka = 0
  for (let i = 0; i < 11; i++) {
    const x = r.lines[i]
    assert.equal(rows[i + 2].length, 19)
    for (const side of ['plus', 'dekamarkt']) {
      const p = x[side]
      assert.equal(p.status, 'known')
      assert.equal(p.packages * p.pricePerPackageCents, p.lineTotalCents)
    }
    plus += x.plus.lineTotalCents
    deka += x.dekamarkt.lineTotalCents
    assert.equal(rows[i + 2][9], money(x.plus.lineTotalCents))
    assert.equal(rows[i + 2][16], money(x.dekamarkt.lineTotalCents))
    assert.equal(rows[i + 2][17], money(x.provisionalLineDeltaCents))
  }
  assert.equal(plus, r.fullBasket.plusTotalCents)
  assert.equal(deka, r.fullBasket.dekamarktTotalCents)
  assert.equal(deka - plus, r.fullBasket.deltaCents)
  assert.equal(rows[13][9], money(plus))
  assert.equal(rows[13][16], money(deka))
  assert.equal(rows[13][17], money(deka - plus))
  assert.match(rows[13][18], /niet onafhankelijk geverifieerd/u)
})

test('M3: 110 independent unit advice calls never rewrite totals, CSV, or public status', () => {
  const r = fixture()
  const frozen = JSON.stringify(r)
  const csv = renderPrivateM3ComparisonCsv(r)
  const winner = r.fullBasket.outcome
  let n = 0
  for (const line of r.lines) for (const side of ['plus', 'dekamarkt']) {
    for (const [packUnit, packAmount] of [
      ['g', 333], ['kg', 0.333], ['ml', 450], ['l', 0.45], ['piece', 7]
    ]) {
      const advice = privateM3PackUnitPrice({ ...line[side], packUnit, packAmount })
      assert.ok(advice && Number.isSafeInteger(advice.cents) && advice.cents >= 0)
      assert.equal(r.fullBasket.outcome, winner)
      assert.equal(r.publicSavingsClaimEligible, false)
      n++
    }
  }
  assert.equal(n, 110)
  assert.equal(JSON.stringify(r), frozen)
  assert.equal(renderPrivateM3ComparisonCsv(r), csv)
})

for (const field of ['plusTotalCents', 'dekamarktTotalCents', 'deltaCents']) {
  test('M3: reject a forged whole-basket ledger field: ' + field, () => {
    const r = fixture()
    r.fullBasket[field] += 1
    const before = JSON.stringify(r)
    assert.throws(() => renderPrivateM3ComparisonCsv(r))
    assert.equal(JSON.stringify(r), before)
  })
}
test('M3: private CSV refuses forged public savings eligibility', () => {
  const r = fixture()
  r.publicSavingsClaimEligible = true
  assert.throws(() => renderPrivateM3ComparisonCsv(r))
})
