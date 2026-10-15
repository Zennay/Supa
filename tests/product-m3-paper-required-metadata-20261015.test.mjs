import assert from 'node:assert/strict'
import test from 'node:test'
import { buildObservationSheet, observationSheetReadiness } from '../src/domain/m3ObservationSheet.ts'
import { renderM3PaperChecklist } from '../scripts/m3-print-field-checklist.mjs'

const sideBlocks = html => [...html.matchAll(/<section class="page" data-m3-side="(baseline|candidate)">([\s\S]*?)<\/section>/g)]

test('M3 field paper preserves identical 11-line demand and visibly collects all required readiness metadata on both retailer pages', () => {
  const html = renderM3PaperChecklist()
  const blocks = sideBlocks(html)
  assert.equal(blocks.length, 2)
  assert.deepEqual(blocks.map(p => p[1]), ['baseline', 'candidate'])
  const sheet = buildObservationSheet()
  assert.equal(sheet.requirements.length, 11)
  const fields = [
    'Studie-ID (zelfde beide bladen):',
    'Deelnemercode (pseudoniem, geen naam/e-mail):',
    'Doelgroep:', 'Regio:', 'Week vanaf (maandag):',
    'Prijscontext: ☐ in-store ☐ online-order',
    'Winkel-ID (uniek per winkel):', 'Filiaal / winkelnaam:',
    'Bewijs-ID (uniek per meting):', 'Datum, tijd en tijdzone:',
    'Bron: ☐ winkelmand ☐ bon ☐ toegestane export',
    'Herkomstnotitie (wat, waar, hoe):',
  ]
  for (const [sideIndex, match] of blocks.entries()) {
    const section = match[2]
    for (const field of fields) {
      assert.ok(section.includes(field), `Missing required M3 field: ${field}`)
    }
    assert.match(section, /Gedeelde studiegegevens moeten op beide bladen gelijk zijn/)
    assert.match(section, /Winkel-ID en bewijs-ID zijn per winkel verschillend/)
    assert.equal((section.match(/data-m3-row="/g) || []).length, 11)
    assert.equal((section.match(/☐ ja ☐ nee ☐ onbekend/g) || []).length, 11)
    assert.equal((section.match(/NIET het aantal te kopen pakken/g) || []).length, 1)
    for (const [i, demand] of sheet.requirements.entries()) {
      const unit = demand.unit === 'piece' ? demand.amount === 1 ? 'stuk' : 'stuks' : demand.unit
      assert.match(section, new RegExp(`data-m3-row="${i + 1}"[^]*?<strong>${i + 1}\\. ${demand.label}<\\/strong><small>Benodigd: ${demand.amount} ${unit}<\\/small>`))
    }
    assert.match(section, sideIndex === 0 ? /PLUS — dezelfde 11 boodschappen/ : /DekaMarkt — dezelfde 11 boodschappen/)
  }
  assert.equal(renderM3PaperChecklist(), html)
})

test('M3 paper mandatory metadata slots are blank, not fictitious observed evidence or a public claim', () => {
  const before = structuredClone(buildObservationSheet())
  const html = renderM3PaperChecklist()
  // The canonical empty sheet really is unready with missing study, store and provenance fields.
  const missing = observationSheetReadiness(before)
  assert.equal(missing.ready, false)
  for (const expected of ['Study ID ontbreekt.', 'Participant key ontbreekt.', 'Populatie ontbreekt.', 'Regio ontbreekt.', 'Winkel A: winkel-ID ontbreekt.', 'Winkel B: winkel-ID ontbreekt.', 'Winkel A: evidence ID ontbreekt.', 'Winkel B: evidence ID ontbreekt.']) {
    assert.ok(missing.issues.includes(expected), expected)
  }
  assert.match(html, /geen bewijs of besparingsclaim/)
  assert.match(html, /geen naam\/e-mail/)
  assert.doesNotMatch(html, /<script\b|https?:\/\/(?:plus|dekamarkt)\.nl|€\s*\d+[.,]\d\d/i)
  assert.match(html, /@page\{size:A4 landscape/)
  assert.deepEqual(buildObservationSheet(), before)
})
