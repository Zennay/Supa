import assert from 'node:assert/strict'
import test from 'node:test'
import { renderM3PaperChecklist } from '../scripts/m3-print-field-checklist.mjs'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

function sections(markup) {
  return [...markup.matchAll(/<section class="page" data-m3-side="(baseline|candidate)">([\s\S]*?)<\/section>/g)]
}

test('M3 two A4 paper sheets retain all 22 genuine-demand blanks and 12 required metadata slots each', () => {
  const before = structuredClone(buildObservationSheet())
  const html = renderM3PaperChecklist()
  const pages = sections(html)
  assert.deepEqual(pages.map(page => page[1]), ['baseline', 'candidate'])
  assert.equal((html.match(/data-m3-row="/g) || []).length, 22)
  assert.equal((html.match(/☐ ja ☐ nee ☐ onbekend/g) || []).length, 22)
  assert.equal((html.match(/<th>Prijs per verkoopverpakking \(€\)<\/th>/g) || []).length, 2)
  for (const [, side, page] of pages) {
    assert.match(page, side === 'baseline' ? /PLUS — dezelfde 11 boodschappen/ : /DekaMarkt — dezelfde 11 boodschappen/)
    assert.equal((page.match(/data-m3-row="/g) || []).length, 11)
    for (const field of [
      'Studie-ID (zelfde beide bladen):', 'Deelnemercode (pseudoniem, geen naam/e-mail):',
      'Doelgroep:', 'Regio:', 'Week vanaf (maandag):', 'Prijscontext:',
      'Winkel-ID (uniek per winkel):', 'Filiaal / winkelnaam:',
      'Bewijs-ID (uniek per meting):', 'Datum, tijd en tijdzone:',
      'Bron: ☐ winkelmand ☐ bon ☐ toegestane export',
      'Herkomstnotitie (wat, waar, hoe):',
    ]) assert.ok(page.includes(field), `Required M3 paper field missing: ${field}`)
    assert.match(page, /Per verkrijgbaar product:/)
    assert.match(page, /geen bewijs of besparingsclaim/)
  }
  assert.doesNotMatch(html, /<script\b|https?:\/\/(?:plus|dekamarkt)\.nl|€\s*\d+[.,]\d{2}/i)
  assert.deepEqual(buildObservationSheet(), before)
})

test('M3 paper print CSS explicitly bounds A4 landscape to one complete retailer section', () => {
  const html = renderM3PaperChecklist()
  // This is a structural CSS regression, NOT a browser pagination oracle.
  // An offline matching-layout PDF reproduction was visually reviewed with
  // WeasyPrint; actual browser/printer differences still need operator check.
  assert.match(html, /@page\{size:A4 landscape;margin:10mm\}/)
  assert.match(html, /body\{font:12px\/1\.2 Arial,sans-serif;color:#111;margin:0\}/)
  assert.match(html, /\.metadata\{display:grid;grid-template-columns:1fr 1fr 1fr;/)
  assert.match(html, /\.page>p\{margin:2px 0\}/)
  assert.match(html, /th,td\{border:1px solid #555;padding:2px;/)
  assert.match(html, /td\{height:26px\}/)
  assert.match(html, /\.page\{break-after:page;page-break-after:always\}/)
  assert.match(html, /\.page:last-child\{break-after:auto;page-break-after:auto\}/)
  assert.equal(renderM3PaperChecklist(), html)
})
