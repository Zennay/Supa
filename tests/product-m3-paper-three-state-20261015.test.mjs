import assert from 'node:assert/strict'
import test from 'node:test'
import { renderM3PaperChecklist } from '../scripts/m3-print-field-checklist.mjs'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

test('M3 paper observation: all 22 store rows distinguish observed yes, observed no and unknown', () => {
  const html = renderM3PaperChecklist()
  const rows = [...html.matchAll(/<tr data-m3-row="\d+">[\s\S]*?<\/tr>/g)].map(match => match[0])
  assert.equal(rows.length, 22)
  for (const row of rows) {
    assert.equal((row.match(/☐ ja ☐ nee ☐ onbekend/g) || []).length, 1)
  }
  assert.equal((html.match(/Ja: product en prijs werkelijk gezien/g) || []).length, 2)
  assert.equal((html.match(/Onbekend: niet gecontroleerd/g) || []).length, 2)
  assert.equal((html.match(/Bij nee en onbekend geen product of prijs invullen/g) || []).length, 2)
  assert.equal((html.match(/<th>Beschikbaar\?<\/th>/g) || []).length, 2)
  assert.equal(buildObservationSheet().baseline.lines.length, 11)
  assert.equal(buildObservationSheet().candidate.lines.length, 11)
})

test('M3 paper observation: presentation does not create evidence, price or participant data', () => {
  const canonical = structuredClone(buildObservationSheet())
  const html = renderM3PaperChecklist()
  assert.equal(html, renderM3PaperChecklist())
  assert.match(html, /geen bewijs of besparingsclaim/)
  assert.match(html, /niet verkrijgbaar is pas nee na controle/)
  assert.doesNotMatch(html, /<script\b/i)
  assert.doesNotMatch(html, /€\s*\d+[.,]\d{2}/)
  assert.deepEqual(buildObservationSheet(), canonical)
})
