import assert from 'node:assert/strict'
import test from 'node:test'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { renderM3FieldVisitCard } from '../src/domain/m3FieldVisitCard.ts'

function expectedDemandLine(requirement, index) {
  const { label, amount, unit } = requirement
  assert.ok(Number.isFinite(amount) && amount > 0, 'source requirement must be a positive finite number')
  const localizedNumber = String(amount).replace('.', ',')
  const displayUnit = unit === 'piece'
    ? (amount === 1 ? 'stuk' : 'stuks')
    : unit
  assert.ok(['stuk', 'stuks', 'g', 'kg', 'ml', 'l'].includes(displayUnit), 'do not silently print unknown canonical units')
  return `${index + 1}. ${label} — nodig: ${localizedNumber} ${displayUnit}`
}

function printedDemandRows(card) {
  return card.split('\n').filter((line) => /^\d+\. /.test(line))
}

test('printed M3 quantity and unit are exact copies of the canonical planned demand', () => {
  const canonical = buildObservationSheet()
  const expected = canonical.requirements.map(expectedDemandLine)
  assert.equal(expected.length, 11)
  const rendered = printedDemandRows(renderM3FieldVisitCard())
  // Equality, not a substring check: a wrong unit, duplicated label, swapped
  // quantity or presentation rounding must never pass this regression.
  assert.deepEqual(rendered, [...expected, ...expected])
  assert.deepEqual(canonical.baseline.lines.map(({ ingredientId, requirement }) => ({
    ingredientId, ...requirement,
  })), canonical.candidate.lines.map(({ ingredientId, requirement }) => ({
    ingredientId, ...requirement,
  })))
  assert.deepEqual(canonical.requirements.map(({ id, amount, unit }) => ({ ingredientId: id, amount, unit })),
    canonical.baseline.lines.map(({ ingredientId, requirement }) => ({ ingredientId, ...requirement })))
})

test('both one-store card modes preserve the exact same demand, not a reconstructed approximation', () => {
  const expected = buildObservationSheet().requirements.map(expectedDemandLine)
  const plus = renderM3FieldVisitCard('baseline')
  const deka = renderM3FieldVisitCard('candidate')
  assert.deepEqual(printedDemandRows(plus), expected)
  assert.deepEqual(printedDemandRows(deka), expected)
  assert.equal(plus.includes('## DekaMarkt —'), false)
  assert.equal(deka.includes('## PLUS —'), false)
  assert.equal(printedDemandRows(renderM3FieldVisitCard()).length, expected.length * 2)
})

test('field card remains deterministic and non-evidence across repeated rendering', () => {
  const before = structuredClone(buildObservationSheet())
  const first = renderM3FieldVisitCard()
  assert.equal(renderM3FieldVisitCard(), first)
  assert.deepEqual(buildObservationSheet(), before)
  assert.match(first, /GEEN bewijs/)
  assert.match(first, /officiële M3 JSON-observatie/)
  assert.doesNotMatch(first, /\bEUR\s*\d+[,.]\d{2}\b|https?:\/\/|@example\./)
})
