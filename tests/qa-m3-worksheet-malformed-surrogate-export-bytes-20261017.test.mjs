/**
 * Independent producer-boundary M3 QA (frozen #3718): original recipe labels
 * must not silently alias under UTF-8 output encoding. Private six-source
 * historical fixtures only; zero retailer network or real store observations.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  RETAILER_REVIEWED_FIXTURES,
  readBoundedRegularReviewedFixture,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildPrivateSelectedWeekObservationWorksheet } from '../scripts/retailer-private-selected-week-observation.mjs'

const sourceArchives = Promise.all(RETAILER_REVIEWED_FIXTURES.map(filename =>
  readBoundedRegularReviewedFixture(fileURLToPath(new URL('../fixtures/m1/' + filename, import.meta.url)))))

function safelyExport(records, sourceLabel) {
  const recipes = structuredClone(m2Recipes)
  recipes[0].ingredients[0].label = sourceLabel
  try {
    const result = buildPrivateSelectedWeekObservationWorksheet(records, ['Ma'], {
      plan: structuredClone(m2InitialPlan),
      recipes,
    })
    assert.equal(result.rows, 10)
    assert.equal(result.observedStorePrices, 0)
    assert.equal(result.productionReady, false)
    assert.equal(result.publicSavingsClaimEligible, false)
    assert.equal((result.csv.match(/"UNOBSERVED_TEMPLATE_NOT_EVIDENCE"/gu) ?? []).length, 10)
    return Buffer.from(result.csv, 'utf8')
  } catch (error) {
    assert.match(String(error), /refus|invalid|label|ingredient|planner|recipe/iu)
    return null
  }
}

test('legitimate surrogate pairs, multilingual glyphs and literal U+FFFD remain distinct in UTF-8', async () => {
  const records = await sourceArchives
  const emoji = safelyExport(records, 'Kip 🥦 Борщ')
  const literal = safelyExport(records, 'Kip � Борщ')
  assert.ok(emoji !== null && literal !== null)
  assert.ok(Buffer.compare(emoji, literal) !== 0, 'valid original glyphs need distinct CSV bytes')
})

for (const [description, malformed, literal] of [
  ['lone high surrogate inside word', 'Kip\ud800Borst', 'Kip\ufffdBorst'],
  ['lone low surrogate inside word', 'Kip\udc00Borst', 'Kip\ufffdBorst'],
  ['lone high surrogate after valid UTF-8 text', 'Crème\ud800', 'Crème\ufffd'],
]) {
  test('lossy UTF-8 must not alias two original planner labels: ' + description, async () => {
    const records = await sourceArchives
    assert.notEqual(malformed, literal)
    const original = safelyExport(records, malformed)
    const explicitlyTypedReplacement = safelyExport(records, literal)
    // Reject ill-formed original UTF-16 atomically OR provide a reversible
    // byte-safe representation; UTF-8 U+FFFD replacement is not reversible.
    if (original !== null && explicitlyTypedReplacement !== null) {
      assert.ok(Buffer.compare(original, explicitlyTypedReplacement) !== 0,
        'different source ingredient labels collapsed into the same UTF-8 worksheet')
    }
  })
}
