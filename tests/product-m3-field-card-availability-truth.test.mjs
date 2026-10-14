import assert from 'node:assert/strict'
import test from 'node:test'

import { renderM3FieldVisitCard } from '../src/domain/m3FieldVisitCard.ts'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

test('blank M3 field cards keep measured no and unmeasured unknown operationally distinct', () => {
  for (const selection of ['both', 'baseline', 'candidate']) {
    const card = renderM3FieldVisitCard(selection)
    assert.match(card, /Niet verkrijgbaar = werkelijk als afwezig gezien/)
    assert.match(card, /onbekend = nog niet gemeten/)
    assert.match(card, /verschillende statussen/)
    assert.match(card, /Bij nee\/onbekend: laat product, verpakking en prijs leeg/)
    assert.match(card, /Onbekend is niet hetzelfde als nee/)
    assert.doesNotMatch(card, /Onbekend of niet verkrijgbaar blijft onbekend/)
    assert.match(card, /GEEN bewijs/)
    assert.doesNotMatch(card, /€\s*\d|\bEUR\s*\d/)
  }
})

test('both printable retailer cards inherit the untouched eleven canonical ingredients and exact quantities', () => {
  const source = buildObservationSheet().requirements
  assert.equal(source.length, 11)
  const total = renderM3FieldVisitCard('both')
  const plus = renderM3FieldVisitCard('baseline')
  const deka = renderM3FieldVisitCard('candidate')
  for (const requirement of source) {
    const displayAmount = String(requirement.amount).replace('.', ',')
    const unit = requirement.unit === 'piece'
      ? (requirement.amount === 1 ? 'stuk' : 'stuks')
      : requirement.unit
    const expected = `${requirement.label} — nodig: ${displayAmount} ${unit}`
    assert.equal(total.split(expected).length - 1, 2, expected)
    assert.equal(plus.split(expected).length - 1, 1, expected)
    assert.equal(deka.split(expected).length - 1, 1, expected)
  }
})
