import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  RETAILER_REVIEWED_FIXTURES,
  readBoundedRegularReviewedFixture,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'
import {
  buildPrivateSelectedWeekObservationWorksheet as produce,
} from '../scripts/retailer-private-selected-week-observation.mjs'
import {
  auditPrivateWorksheetCsv as audit,
} from '../scripts/qa-m3-private-worksheet-preflight.mjs'

// Composed, executable producer -> independent operator QA consumer acceptance.
// Base is the immutable QA scanner #3724, whose parent is product #3718.
// Do not modify either owner's code; do not infer a real current retail price.
const MAX_BYTES = 1_048_576

async function captures() {
  const base = new URL('../fixtures/m1/', import.meta.url)
  return Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(name, base)))))
}
function inputWithLabel(label) {
  const plan = structuredClone(m2InitialPlan)
  const recipes = structuredClone(m2Recipes)
  recipes[0].ingredients[0].label = label
  return { plan, recipes }
}
function assertNoEvidence(result) {
  assert.equal(result.evidenceStatus, 'collection-template-not-evidence')
  assert.equal(result.observedStorePrices, 0)
  assert.equal(result.productionReady, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.rows, 10)
  assert.equal((result.csv.match(/UNOBSERVED_TEMPLATE_NOT_EVIDENCE/g) ?? []).length, 10)
}
function roundTrip(sources, label) {
  const sheet = produce(sources, ['Ma'], inputWithLabel(label))
  assertNoEvidence(sheet)
  const checked = audit(sheet.csv)
  assert.equal(checked.rows, sheet.rows)
  assert.equal(checked.productionReady, false)
  assert.equal(checked.publicSavingsClaimEligible, false)
  assert.equal(Buffer.byteLength(sheet.csv, 'utf8') <= MAX_BYTES, true)
  return sheet
}

test('real offline producer and independent operator audit agree for ordinary and 512-unit Unicode demand', async () => {
  const sources = await captures()
  const immutable = structuredClone(sources)
  for (const label of [
    'Crème fraîche 🍋',
    'शाकाहारी क्‍ष',
    'é'.repeat(512),
    '🍋'.repeat(256), // 512 UTF-16 code units, 1024 UTF-8 bytes
  ]) {
    const result = roundTrip(sources, label)
    assert.equal(result.csv.includes('"' + label + '"'), true)
  }
  assert.deepEqual(sources, immutable)
})

test('producer must not emit a 513-unit worksheet rejected by its own audited operator path', async () => {
  const sources = await captures()
  const label = 'Kippendij ' + 'a'.repeat(503)
  assert.equal(label.length, 513)
  assert.throws(() => produce(sources, ['Ma'], inputWithLabel(label)), Error)
})

test('producer must reject an over-512-unit supplementary Unicode label before operator audit', async () => {
  const sources = await captures()
  const label = '🍋'.repeat(257)
  assert.equal(label.length, 514)
  assert.throws(() => produce(sources, ['Ma'], inputWithLabel(label)), Error)
})

test('producer must refuse 2050-unit printable labels rather than emit scanner-incompatible CSV', async () => {
  const sources = await captures()
  const label = 'Kippendij ' + 'x'.repeat(2040)
  assert.ok(label.length > 2048)
  assert.throws(() => produce(sources, ['Ma'], inputWithLabel(label)), Error)
})

test('retailer-paired output must not expand one allowed inert string above 1MiB human CSV budget', async () => {
  const sources = await captures()
  const label = 'Kippendij ' + 'x'.repeat(524_278)
  assert.equal(label.length, 524_288)
  assert.throws(() => produce(sources, ['Ma'], inputWithLabel(label)), Error)
})

test('100 independently selected needs remain 200 private audited rows, not truncated', async () => {
  const sources = await captures()
  const immutable = structuredClone(sources)
  const days = m2InitialPlan.map(meal => meal.day)
  const plan = days.map((day, index) => ({ day, recipeId: 'qa-100-' + index }))
  const recipes = days.map((day, index) => ({
    ...structuredClone(m2Recipes[0]),
    id: 'qa-100-' + index,
    ingredients: Array.from({ length: 25 }, (_, position) => ({
      id: 'qa-100-need-' + index + '-' + position,
      label: '🍋'.repeat(256), query: 'geen bronwaarneming',
      amount: 1, unit: 'g',
    })),
  }))
  const sheet = produce(sources, days, { plan, recipes })
  assert.equal(sheet.rows, 200)
  assert.equal(sheet.productionReady, false)
  assert.equal(sheet.publicSavingsClaimEligible, false)
  assert.equal(sheet.observedStorePrices, 0)
  assert.equal((sheet.csv.match(/UNOBSERVED_TEMPLATE_NOT_EVIDENCE/g) ?? []).length, 200)
  const checked = audit(sheet.csv)
  assert.equal(checked.rows, 200)
  assert.equal(checked.productionReady, false)
  assert.equal(Buffer.byteLength(sheet.csv, 'utf8') <= MAX_BYTES, true)
  assert.deepEqual(sources, immutable)
})

test('all 15 nonempty real planner day subsets round-trip to independent private scanner', async () => {
  const sources = await captures()
  const unchanged = structuredClone(sources)
  const days = m2InitialPlan.map(meal => meal.day)
  for (let mask = 1; mask < (1 << days.length); mask++) {
    const selectedDays = days.filter((_, index) => Boolean(mask & (1 << index)))
    const generated = produce(sources, selectedDays)
    assert.equal(generated.productionReady, false)
    assert.equal(generated.publicSavingsClaimEligible, false)
    assert.equal(generated.observedStorePrices, 0)
    assert.equal((generated.csv.match(/UNOBSERVED_TEMPLATE_NOT_EVIDENCE/g) ?? []).length,
      generated.rows)
    const scanned = audit(generated.csv)
    assert.equal(scanned.rows, generated.rows)
    assert.equal(scanned.productionReady, false)
    assert.equal(scanned.publicSavingsClaimEligible, false)
    assert.ok(Buffer.byteLength(generated.csv, 'utf8') <= MAX_BYTES)
  }
  assert.deepEqual(sources, unchanged, 'offline archived retail evidence stays immutable')
})

test('producer output must be accepted by independent auditor or atomically refused upstream', async () => {
  const sources = await captures()
  const input = inputWithLabel('Kippendij ' + 'a'.repeat(503))
  let sheet
  try {
    sheet = produce(sources, ['Ma'], input)
  } catch (error) {
    assert.ok(error instanceof Error)
    return
  }
  assertNoEvidence(sheet)
  assert.doesNotThrow(() => audit(sheet.csv),
    'never hand a customer a human worksheet that its independently reviewed scanner refuses')
})

function inputWithQuantity(quantity) {
  const plan = structuredClone(m2InitialPlan)
  const recipes = structuredClone(m2Recipes)
  recipes[0].ingredients[0].amount = quantity
  return { plan, recipes }
}

test('operator-collectable decimal quantity minimum and maximum survive producer→auditor exactly', async () => {
  const sources = await captures()
  const original = structuredClone(sources)
  for (const quantity of [0.000001, 0.00001, 1, 1_000_000]) {
    const sheet = produce(sources, ['Ma'], inputWithQuantity(quantity))
    assertNoEvidence(sheet)
    const checked = audit(sheet.csv)
    assert.equal(checked.rows, sheet.rows)
    assert.equal(checked.productionReady, false)
    assert.equal(checked.publicSavingsClaimEligible, false)
    assert.equal(sheet.csv.includes('"' + String(quantity) + '"'), true)
  }
  assert.deepEqual(sources, original)
})

test('one 1e-7 ingredient must not create a worksheet that operator audit refuses', async () => {
  const sources = await captures()
  assert.throws(() => produce(sources, ['Ma'], inputWithQuantity(0.0000001)),
    Error, '1e-7 needs an explicitly supported 7-decimal measurement; CSV scanner permits only 6')
})

test('one excessive integer 100 million must be refused upstream, not handed to the operator', async () => {
  const sources = await captures()
  assert.throws(() => produce(sources, ['Ma'], inputWithQuantity(100_000_000)),
    Error, 'the independent human scanner caps independently collectable positive quantities')
})

test('one 1e21 scientific quantity must not be exported as a deceptively valid private observation', async () => {
  const sources = await captures()
  assert.throws(() => produce(sources, ['Ma'], inputWithQuantity(1e21)),
    Error, '1e+21 emitted by Number.toString is uncollectable by the human scanner')
})
