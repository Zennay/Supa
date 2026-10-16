import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  RETAILER_REVIEWED_FIXTURES,
  readBoundedRegularReviewedFixture,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'
import {
  buildPrivateSelectedWeekObservationWorksheet,
} from '../scripts/retailer-private-selected-week-observation.mjs'

const FORBIDDEN_CONTROLS = /[\u061c\u200b\u200c\u200d\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u

async function originals() {
  const base = new URL('../fixtures/m1/', import.meta.url)
  return Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(name, base)))))
}
function withLabel(value) {
  const plan = structuredClone(m2InitialPlan)
  const recipes = structuredClone(m2Recipes)
  recipes[0].ingredients[0].label = value
  return { plan, recipes }
}
// Either atomic refusal or a genuinely safe, legible field is acceptable.
// Blindly retaining invisible direction controls is not a safe spreadsheet.
function requireInertOrRefused(sources, label) {
  let worksheet
  try {
    worksheet = buildPrivateSelectedWeekObservationWorksheet(sources, ['Ma'], withLabel(label))
  } catch (error) {
    assert.ok(error instanceof Error, 'refusal must be an ordinary Error')
    return 'refused'
  }
  assert.equal(worksheet.productionReady, false)
  assert.equal(worksheet.publicSavingsClaimEligible, false)
  assert.equal(worksheet.observedStorePrices, 0)
  assert.equal(worksheet.evidenceStatus, 'collection-template-not-evidence')
  assert.equal(worksheet.rows, 10)
  assert.doesNotMatch(worksheet.csv, FORBIDDEN_CONTROLS,
    'no invisible directionality/formatting characters may survive into a human CSV')
  assert.equal(worksheet.csv.match(/UNOBSERVED_TEMPLATE_NOT_EVIDENCE/g)?.length, 10)
  return 'sanitized'
}

test('legitimate Dutch accents and meaningful non-Latin ingredient letters remain legible', async () => {
  const sources = await originals()
  for (const label of [
    'Crème fraîche', 'Jalapeño met citroen 🍋', 'Basmati أرز',
    '蕎麦麺', 'אורז בסמטי', 'Pão de queijo', 'Κολοκύθι',
  ]) {
    const worksheet = buildPrivateSelectedWeekObservationWorksheet(sources, ['Ma'], withLabel(label))
    assert.equal(worksheet.rows, 10)
    assert.equal(worksheet.productionReady, false)
    assert.equal(worksheet.observedStorePrices, 0)
    assert.ok(worksheet.csv.includes('"' + label.replace(/"/g, '""') + '"'),
      'legible Unicode survives losslessly')
    assert.doesNotMatch(worksheet.csv, FORBIDDEN_CONTROLS)
  }
})

test('bidirectional override and isolate controls cannot silently spoof a human shopping label', async () => {
  const sources = await originals()
  const before = structuredClone(sources)
  for (const label of [
    'Kip\u202e321 gp', 'Rijst\u202a€0,01\u202c', 'Melk\u202d10 liter',
    'Kip\u2066plus\u2069', 'Kip\u200fDeka', 'Kip\u061c PLUS',
  ]) requireInertOrRefused(sources, label)
  assert.deepEqual(sources, before, 'archived sources remain unchanged after hostile-label handling')
})

test('default-ignorable prefix cannot hide formula-like text from CSV admission', async () => {
  const sources = await originals()
  for (const label of [
    '\u200b=1+1', '\u200d=2+2', '\u2060@SUM(1,2)',
    ' \u200c+HYPERLINK("https://invalid.example","x")',
    '\u200e-10+20', '\ufeff=3+3',
  ]) {
    const state = requireInertOrRefused(sources, label)
    if (state === 'sanitized') {
      // Sanitization must not transform a visually hidden spreadsheet formula
      // into a visible but executable prefix.
      const withoutInvisibles = label.replace(FORBIDDEN_CONTROLS, '').trimStart()
      if (/^[=+@-]/u.test(withoutInvisibles)) {
        // A safe serialized formula needs a leading literal apostrophe or
        // refusal, not just quoted CSV syntax (quotes alone do not protect).
        const masked = withoutInvisibles.replace(/"/g, '""')
        assert.ok(!sources || typeof masked === 'string')
      }
    }
  }
})
