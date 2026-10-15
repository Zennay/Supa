import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildObservedComparisonPreview } from '../src/features/comparison/observedStoreComparison.ts'

// Pure in-memory, entirely fictional M3 research; no localStorage or retailer
// HTTP. Canonical *demand* can be valid while a direct caller still supplies
// malformed store metadata. Neither a thrown runtime exception nor known
// prices in the fallback are safe outcomes for a public-facing comparison.
const NOW = Date.parse('2026-10-15T12:00:00Z')
const forgedStores = [
  ['PLUS store replaced by null', sheet => { sheet.baseline.store = null }],
  ['DekaMarkt store replaced by undefined', sheet => { sheet.candidate.store = undefined }],
  ['PLUS ID null instead of a string', sheet => { sheet.baseline.store.id = null }],
  ['DekaMarkt ID numeric instead of a string', sheet => { sheet.candidate.store.id = 44 }],
  ['PLUS name boolean instead of a string', sheet => { sheet.baseline.store.name = false }],
  ['DekaMarkt name array instead of a string', sheet => { sheet.candidate.store.name = [] }],
  ['PLUS store ID present but name missing', sheet => { sheet.baseline.store = { id: 'plus-only' } }],
  ['DekaMarkt store name present but ID missing', sheet => { sheet.candidate.store = { name: 'DekaMarkt' } }],
]

for (const [label, mutate] of forgedStores) {
  test('EXPECTED RED: direct M3 comparison fails closed on ' + label, () => {
    const input = buildFictionalPricedSheet(90)
    mutate(input)
    const unchanged = JSON.stringify(input)
    let result
    assert.doesNotThrow(() => {
      result = buildObservedComparisonPreview(input, NOW)
    }, 'untrusted direct M3 sheet must abstain, not crash a browser comparison')
    assert.equal(result.comparable, false)
    assert.equal(result.outcome, 'unknown')
    assert.equal(result.savingsCents, null)
    assert.equal(result.rows.length, 11)
    assert.equal(result.plus.complete, false)
    assert.equal(result.dekamarkt.complete, false)
    assert.equal(result.plus.knownSubtotalCents, null)
    assert.equal(result.dekamarkt.knownSubtotalCents, null)
    assert.ok(result.rows.every(row =>
      row.plus.totalCents === null && row.dekamarkt.totalCents === null &&
      row.differenceCents === null), 'invalid store must never show partial or fabricated money')
    assert.equal(JSON.stringify(input), unchanged, 'never mutate private user draft')
  })
}

test('positive: same valid direct 11+11 draft still calculates fictional preview cents', () => {
  const input = buildFictionalPricedSheet(90)
  const unchanged = JSON.stringify(input)
  const result = buildObservedComparisonPreview(input, NOW)
  assert.equal(result.comparable, true)
  assert.equal(result.outcome, 'better')
  assert.equal(result.savingsCents, 110)
  assert.equal(result.plus.knownSubtotalCents, 1100)
  assert.equal(result.dekamarkt.knownSubtotalCents, 990)
  assert.equal(JSON.stringify(input), unchanged)
})
