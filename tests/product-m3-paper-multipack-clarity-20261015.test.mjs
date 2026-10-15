import assert from 'node:assert/strict'
import test from 'node:test'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { renderM3PaperChecklist } from '../scripts/m3-print-field-checklist.mjs'

function syntheticSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'synthetic-multipack-presentation',
    participantKey: 'synthetic-nonperson',
    population: 'test fixture only',
    region: 'fictional region',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
  })
  for (const [side, storeId, name, hour] of [
    ['baseline', 'synthetic-plus-1', 'PLUS synthetisch', '12'],
    ['candidate', 'synthetic-deka-2', 'DekaMarkt synthetisch', '13'],
  ]) {
    const record = sheet[side]
    record.evidenceId = 'fake-' + side
    record.observedAt = '2026-10-04T' + hour + ':00:00Z'
    record.source = 'manual-cart'
    record.provenanceNote = 'Synthetic unit-test scenario, no real retailer observation.'
    record.store = { id: storeId, name }
    record.lines.forEach((line, index) => {
      const req = sheet.requirements[index]
      line.observedProduct = {
        productId: storeId + '-' + req.id,
        productName: req.query,
        packAmount: req.amount,
        packUnit: req.unit,
        packCount: 1,
        priceCents: 200,
        available: true,
        sourceUrl: '',
        note: 'Synthetic example only.',
      }
    })
  }
  return sheet
}

test('M3 paper: every printed store sheet labels physical multipack contents, not number of packs to buy', () => {
  const before = structuredClone(buildObservationSheet())
  const html = renderM3PaperChecklist()
  assert.equal((html.match(/<th>Inhoud per stuk \(getal \+ eenheid\)<\/th>/g) || []).length, 2)
  assert.equal((html.match(/<th>Stuks per verkoopverpakking<\/th>/g) || []).length, 2)
  assert.equal((html.match(/<th>Prijs per verkoopverpakking \(€\)<\/th>/g) || []).length, 2)
  assert.equal((html.match(/NIET het aantal te kopen pakken; SUPA berekent dat/g) || []).length, 2)
  assert.equal((html.match(/1 bij enkelpak; meer alleen bij multipack/g) || []).length, 2)
  assert.equal((html.match(/☐ ja ☐ nee ☐ onbekend/g) || []).length, 22)
  assert.equal((html.match(/data-m3-row="/g) || []).length, 22)
  assert.doesNotMatch(html, /<th>Aantal pakken<\/th>/)
  assert.doesNotMatch(html, /€\s*\d+[.,]\d\d|<script\b|https?:\/\//i)
  assert.deepEqual(buildObservationSheet(), before)
})

test('M3 converter: packCount means units inside one selling pack; required selling packs are derived', () => {
  const multi = syntheticSheet()
  // 450 g rice demand: one selling multipack with 3 x 150 g costs 200 cents.
  const line = multi.candidate.lines.find(item => item.requirement.unit === 'g')
  assert.ok(line)
  // Use exact canonical requirement so matching and physical rounding remain real.
  const amount = line.requirement.amount / 3
  line.observedProduct.packAmount = amount
  line.observedProduct.packCount = 3
  const productId = line.ingredientId
  const multiStudy = buildWeeklyBasketStudyFromObservationSheet(multi)
  const multiTrace = multiStudy.candidate.basket.lines.find(x => x.id === productId)
  assert.equal(multiTrace.status, 'matched')
  assert.equal(multiTrace.pack.count, 3)
  assert.equal(multiTrace.packs, 1)
  assert.equal(multiTrace.pricePerPackCents, 200)
  assert.equal(multiTrace.lineTotalCents, 200)

  // Treating 3 as packs to buy instead of units per selling pack corrupts totals.
  const single = structuredClone(multi)
  single.candidate.lines.find(item => item.ingredientId === productId).observedProduct.packCount = 1
  const singleStudy = buildWeeklyBasketStudyFromObservationSheet(single)
  const singleTrace = singleStudy.candidate.basket.lines.find(x => x.id === productId)
  assert.equal(singleTrace.status, 'matched')
  assert.equal(singleTrace.pack.count, 1)
  assert.equal(singleTrace.packs, 3)
  assert.equal(singleTrace.pricePerPackCents, 200)
  assert.equal(singleTrace.lineTotalCents, 600)
  // These fictitious euros are *only* regression arithmetic, never field evidence.
  assert.equal(multiStudy.candidate.basket.totalCents + 400, singleStudy.candidate.basket.totalCents)
})
