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

// Mirror the independent downstream operator-preflight's published
// *maximum acceptance* budget, not its implementation or any test file.
// Exporter must never produce a worksheet that cannot pass basic
// human-collection admission even though the plan itself is legal.
const MAX_HUMAN_LABEL_CODE_UNITS = 512
const MAX_PRIVATE_CSV_UTF8_BYTES = 1_048_576

async function offlineSources() {
  const root = new URL('../fixtures/m1/', import.meta.url)
  return Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(name, root)))))
}

function customLabel(label) {
  const plan = structuredClone(m2InitialPlan)
  const recipes = structuredClone(m2Recipes)
  recipes[0].ingredients[0].label = label
  return { plan, recipes }
}

function provePrivate(result) {
  assert.equal(result.evidenceStatus, 'collection-template-not-evidence')
  assert.equal(result.observedStorePrices, 0)
  assert.equal(result.productionReady, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.rows, 10)
  assert.equal((result.csv.match(/UNOBSERVED_TEMPLATE_NOT_EVIDENCE/g) ?? []).length, 10)
  assert.equal((result.csv.match(/"chicken-thigh"/g) ?? []).length, 2)
  assert.equal(Buffer.byteLength(result.csv, 'utf8') <= MAX_PRIVATE_CSV_UTF8_BYTES, true,
    'producer output must remain within the existing independent human preflight byte budget')
}

function mustRejectOrPreserveBounded(records, label) {
  let value
  try {
    value = buildPrivateSelectedWeekObservationWorksheet(records, ['Ma'], customLabel(label))
  } catch (error) {
    assert.equal(error instanceof Error, true, 'rejection must use ordinary Error')
    return 'refused'
  }
  provePrivate(value)
  assert.equal(label.length <= MAX_HUMAN_LABEL_CODE_UNITS, true,
    'oversized local ingredient labels must be rejected atomically; do not silently truncate')
  return 'accepted'
}

test('ordinary and exactly bounded genuine Unicode labels remain private and lossless', async () => {
  const records = await offlineSources()
  const original = structuredClone(records)
  for (const label of ['Kippendij', 'Crème fraîche 🍋', 'हिन्दी क्‍ष', 'é'.repeat(512)]) {
    assert.equal(label.length <= MAX_HUMAN_LABEL_CODE_UNITS, true)
    const value = buildPrivateSelectedWeekObservationWorksheet(
      records, ['Ma'], customLabel(label))
    provePrivate(value)
    assert.equal(value.csv.includes('"' + label + '"'), true,
      'in-bounds legitimate human ingredient identity must remain exact')
  }
  assert.deepEqual(records, original)
})

test('producer refuses 513-code-unit ingredient label that human scanner cannot accept', async () => {
  const sources = await offlineSources()
  const before = structuredClone(sources)
  mustRejectOrPreserveBounded(sources, 'Kippendij ' + 'a'.repeat(503))
  assert.deepEqual(sources, before)
})

test('producer refuses long CSV ingredient text even below inert-source 1MiB per-string limit', async () => {
  const sources = await offlineSources()
  const before = structuredClone(sources)
  mustRejectOrPreserveBounded(sources, 'Kippendij ' + 'x'.repeat(2040))
  assert.deepEqual(sources, before)
})

test('producer prevents duplicate 524KiB labels expanding one selected need beyond 1MiB CSV', async () => {
  const sources = await offlineSources()
  const before = structuredClone(sources)
  // The six archived sources are genuine sanitized private fixtures; no
  // external networking. The pathological label is caller-authored demand.
  // It is under the inert input's 1MiB per-string cap but is repeated twice
  // for two operators and exceeds the separately reviewed CSV size gate.
  const label = 'Kippendij ' + 'x'.repeat(524_278)
  assert.equal(label.length, 524_288)
  mustRejectOrPreserveBounded(sources, label)
  assert.deepEqual(sources, before)
})
