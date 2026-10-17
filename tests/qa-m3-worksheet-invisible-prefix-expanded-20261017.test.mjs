import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import { RETAILER_REVIEWED_FIXTURES, readBoundedRegularReviewedFixture } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildPrivateSelectedWeekObservationWorksheet } from '../scripts/retailer-private-selected-week-observation.mjs'
import { auditPrivateWorksheetCsv } from '../scripts/qa-m3-private-worksheet-preflight.mjs'

async function sourceRows() {
  const root = new URL('../fixtures/m1/', import.meta.url)
  return Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(name, root)))))
}
function exportLabel(records, label) {
  const recipes = structuredClone(m2Recipes)
  recipes[0].ingredients[0].label = label
  const plan = structuredClone(m2InitialPlan)
  return buildPrivateSelectedWeekObservationWorksheet(records, ['Ma'], {plan, recipes}).csv
}

test('QA must reject six other invisible prefix styles ahead of spreadsheet formula syntax', async () => {
  const records = await sourceRows()
  for (const [codepoint, char] of [
    ['U+2063 INVISIBLE SEPARATOR', '\u2063'],
    ['U+2062 INVISIBLE TIMES', '\u2062'],
    ['U+00AD SOFT HYPHEN', '\u00ad'],
    ['U+034F COMBINING GRAPHEME JOINER', '\u034f'],
    ['U+180E MONGOLIAN VOWEL SEPARATOR', '\u180e'],
    ['U+115F HANGUL CHOSEONG FILLER', '\u115f'],
  ]) {
    const csv = exportLabel(records, char + '=SUM(1,2)')
    assert.throws(() => auditPrivateWorksheetCsv(csv),
      /Private worksheet QA audit refused/, codepoint)
    assert.throws(() => auditPrivateWorksheetCsv(exportLabel(records, '  ' + char + '@SUM(1,2)')),
      /Private worksheet QA audit refused/, codepoint + ' with leading whitespace')
  }
})

test('QA must reject invisible word modifiers embedded inside store-facing ingredient text', async () => {
  const records = await sourceRows()
  for (const invisible of ['\u2063', '\u2062', '\u00ad', '\u034f']) {
    const csv = exportLabel(records, 'Kip' + invisible + 'bowl')
    assert.throws(() => auditPrivateWorksheetCsv(csv), /Private worksheet QA audit refused/,
      'human-readable labels must not contain hidden separators')
  }
})

test('real emoji variants, joined emoji, Dutch diacritics and genuine RTL language letters stay valid', async () => {
  const records = await sourceRows()
  for (const good of ['🥦️ verse bloemkool', '👩‍🍳 Kip', 'Crème fraîche', 'हिन्दी क्‍ष', 'می‌روم', 'أرز']) {
    const csv = exportLabel(records, good)
    const report = auditPrivateWorksheetCsv(csv)
    assert.equal(report.rows, 10)
    assert.equal(report.sourceRightsVerified, false)
    assert.equal(report.productionReady, false)
    assert.equal(report.verifiedActualObservations, 0)
  }
})
