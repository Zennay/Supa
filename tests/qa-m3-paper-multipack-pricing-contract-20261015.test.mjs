import assert from 'node:assert/strict'
import test from 'node:test'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { renderM3PaperChecklist } from '../scripts/m3-print-field-checklist.mjs'

// Independent QA after product #2883 landed on main. All values are fictional;
// no retailer HTTP, participant data, source permission or savings entitlement.
function fictionalCompleteSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa-paper-multipack-not-real',
    participantKey: 'fictional-no-person',
    population: 'synthetic test only',
    region: 'fictional area',
    weekStart: '2026-10-12',
    priceContext: 'in-store',
  })
  for (const [side, name, hour] of [
    ['baseline', 'PLUS', '11'],
    ['candidate', 'DekaMarkt', '12'],
  ]) {
    const record = sheet[side]
    record.evidenceId = 'fictional-' + side
    record.observedAt = '2026-10-14T' + hour + ':00:00Z'
    record.provenanceNote = 'Synthetic QA contract, not a retailer observation'
    record.store = { id: 'fictional-' + side, name }
    record.source = 'manual-cart'
    record.lines.forEach((line, index) => {
      const requirement = sheet.requirements[index]
      line.observedProduct = {
        productId: side + '-synthetic-' + requirement.id,
        productName: 'Fictional ' + requirement.label,
        packAmount: requirement.amount,
        packUnit: requirement.unit,
        packCount: 1,
        priceCents: 180,
        available: true,
        sourceUrl: '',
        note: 'synthetic only',
      }
    })
  }
  return sheet
}

test('independent M3 paper contract: both pages unambiguously ask for units inside ONE selling pack', () => {
  const before = structuredClone(buildObservationSheet())
  const html = renderM3PaperChecklist()
  const pages = [...html.matchAll(/<section class="page" data-m3-side="(baseline|candidate)">([\s\S]*?)<\/section>/g)]
  assert.deepEqual(pages.map(page => page[1]), ['baseline', 'candidate'])
  for (const [, , page] of pages) {
    const headers = [...page.matchAll(/<th>([^<]+)<\/th>/g)].map(match => match[1])
    assert.deepEqual(headers, [
      'Ingrediënt/behoefte', 'Gevonden product',
      'Inhoud per stuk (getal + eenheid)',
      'Stuks per verkoopverpakking',
      'Prijs per verkoopverpakking (€)', 'Beschikbaar?',
    ])
    assert.match(page, /aantal stuks IN één verkoopverpakking/)
    assert.match(page, /NIET het aantal te kopen pakken; SUPA berekent dat/)
    assert.match(page, /prijs van die hele verkoopverpakking/)
    const rows = [...page.matchAll(/<tr data-m3-row="\d+">([\s\S]*?)<\/tr>/g)]
    assert.equal(rows.length, 11)
    for (const row of rows) {
      assert.equal((row[1].match(/<td/g) || []).length, 6)
      assert.match(row[1], /☐ ja ☐ nee ☐ onbekend/)
    }
  }
  assert.doesNotMatch(html, /Aantal pakken|€\s*\d+[.,]\d{2}|<script\b|https?:\/\//i)
  assert.deepEqual(buildObservationSheet(), before)
})

test('independent converter matrix: packCount changes contents, NEVER direct number to buy', () => {
  const scenario = fictionalCompleteSheet()
  const line = scenario.candidate.lines.find(item => item.requirement.unit === 'g')
  assert.ok(line, 'canonical demand contains a weighed ingredient')
  const targetId = line.ingredientId
  const demand = line.requirement.amount
  const priceCents = 180
  const measured = []
  for (const [packCount, expectedPacks] of [[1, 4], [2, 2], [4, 1]]) {
    const sheet = structuredClone(scenario)
    const product = sheet.candidate.lines.find(item => item.ingredientId === targetId).observedProduct
    product.packAmount = demand / 4
    product.packCount = packCount
    product.priceCents = priceCents
    const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
    const trace = study.candidate.basket.lines.find(item => item.id === targetId)
    assert.equal(trace.status, 'matched')
    assert.equal(trace.pack.count, packCount)
    assert.equal(trace.packs, expectedPacks)
    assert.equal(trace.pricePerPackCents, priceCents)
    assert.equal(trace.lineTotalCents, expectedPacks * priceCents)
    measured.push({ packCount, packs: trace.packs, total: study.candidate.basket.totalCents })
  }
  assert.deepEqual(measured.map(item => item.packs), [4, 2, 1])
  assert.equal(measured[0].total - measured[1].total, 360)
  assert.equal(measured[1].total - measured[2].total, 180)
})
