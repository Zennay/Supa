import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildObservedComparisonPreview } from '../src/features/comparison/observedStoreComparison.ts'

const NOW = Date.parse('2026-10-15T12:00:00Z')

// All observations are fictional, offline and not authentic savings evidence.
const scenarios = [
  ['extra PLUS item', sheet => sheet.baseline.lines.push({ ...sheet.baseline.lines[0] })],
  ['extra DekaMarkt item', sheet => sheet.candidate.lines.push({ ...sheet.candidate.lines[0] })],
  ['missing PLUS item', sheet => sheet.baseline.lines.pop()],
  ['missing DekaMarkt item', sheet => sheet.candidate.lines.pop()],
  ['sparse PLUS item slot', sheet => { delete sheet.baseline.lines[1] }],
  ['sparse DekaMarkt item slot', sheet => { delete sheet.candidate.lines[1] }],
  ['swapped ingredient labels', sheet => {
    sheet.candidate.lines[0].ingredientLabel = sheet.candidate.lines[1].ingredientLabel
  }],
  ['mutated physical demand', sheet => { sheet.baseline.lines[0].requirement.amount += 100 }],
  ['mutated planner query', sheet => { sheet.requirements[0].query += ' fictional extra' }],
  ['mutated planner quantity', sheet => { sheet.requirements[0].amount *= 2 }],
  ['forged planning day count', sheet => { sheet.selectedMealCount += 1 }],
  ['forged two-day evidence window', sheet => { sheet.study.maxObservationWindowHours = 48 }],
  ['forged template status', sheet => { sheet.evidenceStatus = 'verified' }],
  ['forged top-level extra requirement and both observed rows', sheet => {
    const first = sheet.requirements[0]
    const extra = { ...first, id: 'extra-fake-demand' }
    sheet.requirements.push(extra)
    for (const side of ['baseline', 'candidate']) {
      const line = sheet[side].lines[0]
      sheet[side].lines.push({ ...line, ingredientId: extra.id })
    }
  }],
]

for (const [label, mutate] of scenarios) {
  test('invalid raw M3 direct draft: ' + label + ' cannot show any money', () => {
    const sheet = buildFictionalPricedSheet(90)
    mutate(sheet)
    const after = JSON.stringify(sheet)
    const result = buildObservedComparisonPreview(sheet, NOW)
    assert.equal(result.comparable, false)
    assert.equal(result.outcome, 'unknown')
    assert.equal(result.savingsCents, null)
    assert.equal(result.rows.length, 11, 'show canonical eleven rows, not forged demand')
    assert.equal(result.plus.complete, false)
    assert.equal(result.dekamarkt.complete, false)
    assert.equal(result.plus.knownSubtotalCents, null)
    assert.equal(result.dekamarkt.knownSubtotalCents, null)
    assert.equal(result.rows.every(row =>
      row.plus.totalCents === null &&
      row.dekamarkt.totalCents === null &&
      row.differenceCents === null), true)
    assert.ok(result.reasons.some(reason => reason.includes('vaste M3-productregels')))
    assert.equal(JSON.stringify(sheet), after, 'private observed data must not be mutated')
  })
}

test('unaltered 11+11 canonical direct observation retains precise, non-public comparison', () => {
  const sheet = buildFictionalPricedSheet(90)
  const before = JSON.stringify(sheet)
  const result = buildObservedComparisonPreview(sheet, NOW)
  assert.equal(result.rows.length, 11)
  assert.equal(result.plus.complete, true)
  assert.equal(result.dekamarkt.complete, true)
  assert.equal(result.plus.knownSubtotalCents, 1100)
  assert.equal(result.dekamarkt.knownSubtotalCents, 990)
  assert.equal(result.comparable, true)
  assert.equal(result.outcome, 'better')
  assert.equal(result.savingsCents, 110)
  assert.equal(JSON.stringify(sheet), before)
})
