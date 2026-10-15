import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildObservationSheet,
  observationSheetProgress,
  observationSheetReadiness,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'
import { renderM3PaperChecklist } from '../scripts/m3-print-field-checklist.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'

// Independent M3 paper -> actual readiness/converter acceptance on merged product.
// Everything is synthetic. Never a field measurement, permission or savings claim.
const PAGES = /<section class="page" data-m3-side="(baseline|candidate)">([\s\S]*?)<\/section>/g

function fictionalPair() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa_m3_study_123',
    participantKey: 'qa_pseudonym_456',
    population: 'fabricated student population',
    region: 'fabricated region',
    weekStart: '2026-10-12',
    priceContext: 'in-store',
  })
  for (const [side, name, hour] of [
    ['baseline', 'PLUS', '11'],
    ['candidate', 'DekaMarkt', '12'],
  ]) {
    const observation = sheet[side]
    observation.store.id = 'fictional-store-' + side
    observation.store.name = name
    observation.evidenceId = 'fictional-evidence-' + side
    observation.observedAt = '2026-10-14T' + hour + ':00:00+02:00'
    observation.source = 'manual-cart'
    observation.provenanceNote = 'Synthetic offline-only paper exercise for ' + side
    for (const line of observation.lines) {
      line.observedProduct.available = false
    }
  }
  return sheet
}

test('independent paper readiness: both store pages ask every mandatory shared and store-specific metadata without prefilled proof', () => {
  const original = structuredClone(buildObservationSheet())
  const html = renderM3PaperChecklist()
  const pages = [...html.matchAll(PAGES)]
  assert.deepEqual(pages.map(page => page[1]), ['baseline', 'candidate'])
  const expectedShared = [
    'Studie-ID (zelfde beide bladen)', 'Deelnemercode (pseudoniem, geen naam/e-mail)',
    'Doelgroep:', 'Regio:', 'Week vanaf (maandag)',
    'Prijscontext: ☐ in-store ☐ online-order',
  ]
  const expectedStore = [
    'Winkel-ID (uniek per winkel)', 'Filiaal / winkelnaam',
    'Bewijs-ID (uniek per meting)', 'Datum, tijd en tijdzone',
    'Bron: ☐ winkelmand ☐ bon ☐ toegestane export',
    'Herkomstnotitie (wat, waar, hoe)',
  ]
  for (const [, side, page] of pages) {
    for (const field of [...expectedShared, ...expectedStore]) {
      assert.ok(page.includes(field), side + ': missing ' + field)
    }
    assert.match(page, /Gedeelde studiegegevens moeten op beide bladen gelijk zijn/)
    assert.match(page, /Winkel-ID en bewijs-ID zijn per winkel verschillend/)
    assert.equal((page.match(/data-m3-row="/g) || []).length, 11)
    assert.equal((page.match(/☐ ja ☐ nee ☐ onbekend/g) || []).length, 11)
    assert.doesNotMatch(page, /<script\b|€\s*\d+[.,]\d{2}|https?:\/\//i)
  }
  assert.match(html, /geen bewijs of besparingsclaim/)
  assert.deepEqual(buildObservationSheet(), original)
})

test('independent paper readiness: 22 genuinely CHECKED-but-unavailable fictional lines plus complete metadata pass private input contract but create no price', () => {
  const sheet = fictionalPair()
  const progress = observationSheetProgress(sheet)
  assert.equal(progress.totalLines, 22)
  assert.equal(progress.availabilityRecorded, 22)
  assert.equal(progress.completeLines, 22)
  assert.equal(progress.metadataCompleted, progress.metadataTotal)
  assert.deepEqual(observationSheetReadiness(sheet), {ready: true, issues: []})
  const restored = restoreObservationSheetDraft(JSON.stringify(sheet))
  assert.ok(restored)
  assert.deepEqual(observationSheetReadiness(restored), {ready: true, issues: []})
  const study = buildWeeklyBasketStudyFromObservationSheet(restored)
  for (const side of ['baseline', 'candidate']) {
    const basket = study[side].basket
    assert.equal(basket.lines.length, 11)
    assert.equal(basket.totalCents, 0)
    assert.equal(basket.unresolvedLineCount, 11)
    assert.equal(basket.matchedLineCount, 0)
    assert.ok(basket.lines.every(line => line.status === 'unresolved'))
  }
})

test('independent paper readiness: private study, store and provenance identifiers are all mandatory and must be distinct', async t => {
  const cases = [
    ['study ID', s => { s.study.studyId = '' }, /Study ID ontbreekt/],
    ['participant code', s => { s.study.participantKey = '' }, /Participant key ontbreekt/],
    ['population', s => { s.study.population = '' }, /Populatie ontbreekt/],
    ['region', s => { s.study.region = '' }, /Regio ontbreekt/],
    ['invalid pseudonymous key', s => { s.study.participantKey = 'real@email.example' }, /veilige pseudonieme sleutel/],
    ['blank baseline store ID', s => { s.baseline.store.id = '' }, /Winkel A: winkel-ID ontbreekt/],
    ['same store ID', s => { s.candidate.store.id = s.baseline.store.id }, /verschillende winkel-ID/],
    ['blank candidate evidence ID', s => { s.candidate.evidenceId = '' }, /Winkel B: evidence ID ontbreekt/],
    ['same evidence ID', s => { s.candidate.evidenceId = s.baseline.evidenceId }, /verschillende evidence-ID/],
    ['unidentified retailer', s => { s.candidate.store.name = 'Random Shop' }, /winkelnaam moet DekaMarkt identificeren/],
    ['no baseline provenance', s => { s.baseline.provenanceNote = '' }, /Winkel A: provenance-notitie ontbreekt/],
    ['invisible provenance', s => { s.candidate.provenanceNote = '\u200B' }, /Winkel B: provenance-notitie ontbreekt/],
    ['unsupported source', s => { s.baseline.source = 'unlicensed-scraper' }, /kies een geldige herkomst/],
  ]
  for (const [name, mutate, expected] of cases) {
    await t.test(name, () => {
      const sheet = fictionalPair()
      mutate(sheet)
      const result = observationSheetReadiness(sheet)
      assert.equal(result.ready, false)
      assert.match(result.issues.join('\n'), expected)
    })
  }
})

test('independent paper readiness: strict timezones and 24h window block invalid or unrelated observations', async t => {
  const cases = [
    ['missing time zone', s => { s.baseline.observedAt = '2026-10-14T11:00:00' }, /Winkel A: geldige observatietijd ontbreekt/],
    ['invalid calendar day', s => { s.baseline.observedAt = '2026-02-30T11:00:00Z' }, /Winkel A: geldige observatietijd ontbreekt/],
    ['impossible clock time', s => { s.baseline.observedAt = '2026-10-14T25:00:00Z' }, /Winkel A: geldige observatietijd ontbreekt/],
    ['different-week date', s => { s.study.weekStart = '2026-02-30' }, /Week start moet een geldige datum/],
    ['missing price context', s => { s.study.priceContext = '' }, /Prijscontext ontbreekt/],
    ['observation outside 24h', s => { s.candidate.observedAt = '2026-10-15T12:01:00+02:00' }, /maximaal 24 uur is toegestaan/],
    ['unmeasured available flag', s => { s.candidate.lines[0].observedProduct.available = null }, /beschikbaarheid is nog niet gemeten/],
  ]
  for (const [name, mutate, expected] of cases) {
    await t.test(name, () => {
      const sheet = fictionalPair()
      mutate(sheet)
      const issues = observationSheetReadiness(sheet).issues
      assert.match(issues.join('\n'), expected)
    })
  }
  const pair = fictionalPair()
  const now = Date.parse('2026-10-14T14:00:00Z')
  assert.equal(observationSheetReadiness(pair, now).ready, true)
  pair.candidate.observedAt = '2026-10-14T17:00:00+02:00'
  assert.match(observationSheetReadiness(pair, now).issues.join('\n'), /Winkel B: geldige observatietijd ontbreekt/)
})
