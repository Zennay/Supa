import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assessControlledSourceBasketReadiness,
  assessM3ControlledPlusDekaBasketReadiness,
} from '../src/data/controlledSourceBasketReadiness.ts'

// ALL retailer names, prices, captures, provenance hashes and products here
// are synthetic contract fixtures, NOT real PLUS/DekaMarkt observations.
const referenceTime = '2026-10-10T12:00:00Z'
const baselineStore = Object.freeze({ id: 'source-plus', supermarket: 'plus' })
const candidateStore = Object.freeze({ id: 'source-deka', supermarket: 'dekamarkt' })
const plan = Object.freeze([{ day: 'Ma', recipeId: 'rice' }])
const recipes = Object.freeze([{
  id: 'rice', title: 'Synthetic rice bowl', minutes: 10, servings: 1,
  estimatedCost: 0, tags: [],
  ingredients: [{
    id: 'rice-demand', label: 'Basmati rijst', query: 'basmati rijst',
    amount: 450, unit: 'g',
  }],
}])
const activeDays = Object.freeze(['Ma'])

function observation(supermarket, options = {}) {
  const multi = supermarket === 'dekamarkt'
  return {
    supermarket,
    sourceProductId: 'rice-one',
    name: 'Basmati rijst',
    currentPriceCents: multi ? 299 : 249,
    currency: 'EUR',
    pack: multi
      ? { rawText: '6 x 500 g', amount: 500, unit: 'g' }
      : { rawText: '1 kg', amount: 1, unit: 'kg' },
    offer: null,
    availability: 'available',
    provenance: {
      supermarket, kind: 'product',
      url: multi
        ? 'https://www.dekamarkt.nl/controlled-rice'
        : 'https://www.plus.nl/controlled-rice',
      capturedAt: referenceTime, sha256: 'f'.repeat(64),
    },
    ...options,
  }
}

function input(overrides = {}) {
  return {
    baselineStore, candidateStore,
    baselineStoreName: 'Synthetic PLUS',
    candidateStoreName: 'Synthetic DekaMarkt',
    baselineObservations: [observation('plus')],
    candidateObservations: [observation('dekamarkt')],
    plan, recipes, activeDays, referenceTime,
    ...overrides,
  }
}

test('source-only full-demand pair produces structural pass but NEVER release/savings approval', () => {
  const evidence = input()
  const original = structuredClone(evidence)
  const result = assessControlledSourceBasketReadiness(evidence)
  assert.equal(result.status, 'structural-pass')
  assert.equal(result.releaseEligible, false)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.candidateMinusBaselineCents, 50)
  assert.equal(result.captureWindowHours, 0)
  assert.equal(result.baseline.totalCents, 249)
  assert.equal(result.candidate.totalCents, 299)
  assert.equal(result.baseline.store.name, 'PLUS')
  assert.equal(result.candidate.store.name, 'DekaMarkt')
  assert.equal(result.baseline.lines.length, 1)
  assert.equal(result.candidate.lines[0].pack.count, 6)
  assert.equal(result.candidate.lines[0].packs, 1)
  assert.equal(Object.hasOwn(result, 'savingsCents'), false)
  assert.equal(Object.hasOwn(result, 'claimable'), false)
  assert.deepEqual(evidence, original)
})

test('missing or nonmatching demand in either source cannot be substituted with M2 fixtures', () => {
  const unsupported = observation('dekamarkt', { name: 'Broccoli 500 g' })
  const result = assessControlledSourceBasketReadiness(
    input({ candidateObservations: [unsupported] }),
  )
  assert.deepEqual(result, {
    status: 'structural-fail', releaseEligible: false,
    reason: 'source-or-plan-not-comparable', comparison: null,
  })
  assert.equal(assessControlledSourceBasketReadiness(input({
    baselineObservations: [observation('plus', { name: 'Tomatenblokjes' })],
  })).status, 'structural-fail')
})

test('both sources must cover every planned ingredient, not just the cheapest matching item', () => {
  const twoDemandRecipes = [{
    ...recipes[0],
    ingredients: [
      ...recipes[0].ingredients,
      { id: 'yogurt', label: 'Griekse yoghurt', query: 'griekse yoghurt', amount: 100, unit: 'g' },
    ],
  }]
  assert.equal(assessControlledSourceBasketReadiness(input({ recipes: twoDemandRecipes })).status, 'structural-fail')
  assert.equal(assessControlledSourceBasketReadiness(input({
    recipes: twoDemandRecipes,
    baselineObservations: [
      observation('plus'),
      observation('plus', {
        sourceProductId: 'yogurt-one', name: 'Griekse yoghurt',
        pack: { rawText: '500 g', amount: 500, unit: 'g' },
      }),
    ],
  })).status, 'structural-fail')
  const both = assessControlledSourceBasketReadiness(input({
    recipes: twoDemandRecipes,
    baselineObservations: [
      observation('plus'),
      observation('plus', {
        sourceProductId: 'yogurt-one', name: 'Griekse yoghurt',
        pack: { rawText: '500 g', amount: 500, unit: 'g' },
      }),
    ],
    candidateObservations: [
      observation('dekamarkt'),
      observation('dekamarkt', {
        sourceProductId: 'yogurt-one', name: 'Griekse yoghurt',
        pack: { rawText: '500 g', amount: 500, unit: 'g' },
      }),
    ],
  }))
  assert.equal(both.status, 'structural-pass')
  assert.equal(both.baseline.lines.length, 2)
})

test('a zero-active-meal week cannot generate a fake same-price comparison', () => {
  assert.equal(assessControlledSourceBasketReadiness(input({ activeDays: [] })).status, 'structural-fail')
  assert.equal(assessControlledSourceBasketReadiness(input({
    plan: [], activeDays: [],
  })).status, 'structural-fail')
})

test('future, expired, ambiguous and submillisecond-lossy reference clocks fail closed', () => {
  for (const reference of [
    '2026-10-10T11:59:59Z', '2026-10-11T12:00:01Z',
    '2026-10-10T12:00:00', '2026-10-10T12:00:00.000000001Z',
  ]) {
    const result = assessControlledSourceBasketReadiness(input({ referenceTime: reference }))
    assert.equal(result.status, 'structural-fail')
  }
  assert.equal(assessControlledSourceBasketReadiness(input({
    referenceTime: '2026-10-11T12:00:00Z',
  })).status, 'structural-pass')
})

test('a single out-of-window or promoted row blocks the whole pair', () => {
  const stale = observation('plus')
  stale.provenance.capturedAt = '2026-10-09T11:59:59Z'
  assert.equal(assessControlledSourceBasketReadiness(input({
    baselineObservations: [stale],
  })).status, 'structural-fail')
  assert.equal(assessControlledSourceBasketReadiness(input({
    candidateObservations: [observation('dekamarkt', {
      offer: { label: '2+1 korting', mechanics: null, offerPriceCents: null, originalPriceCents: null, validFrom: null, validTo: null },
    })],
  })).status, 'structural-fail')
  assert.equal(assessControlledSourceBasketReadiness(input({
    candidateObservations: [observation('dekamarkt', {
      pack: { rawText: '6 x 500 g', amount: 500, unit: 'g', count: 1 },
    })],
  })).status, 'structural-fail')
})

test('valid full 24h window and timezone offset preserve structurally comparable result', () => {
  const old = observation('plus')
  old.provenance.capturedAt = '2026-10-09T12:00:00Z'
  const fresh = observation('dekamarkt')
  fresh.provenance.capturedAt = '2026-10-10T14:00:00+02:00'
  const result = assessControlledSourceBasketReadiness(input({
    baselineObservations: [old], candidateObservations: [fresh],
  }))
  assert.equal(result.status, 'structural-pass')
  assert.equal(result.captureWindowHours, 24)
})

test('retailer display labels come from bound sources, not caller-supplied misleading names', () => {
  const result = assessControlledSourceBasketReadiness(input({
    baselineStoreName: 'DekaMarkt', candidateStoreName: 'PLUS',
  }))
  assert.equal(result.status, 'structural-pass')
  assert.equal(result.baseline.store.name, 'PLUS')
  assert.equal(result.candidate.store.name, 'DekaMarkt')
})

test('malformed caller shapes and hostile getter never disclose diagnostic or throw', () => {
  for (const value of [null, [], {}, { ...input(), baselineStore: null },
    input({ plan: 'not-an-array' }), input({ activeDays: ['Ma', 'Ma'] }),
    input({ activeDays: [' Ma'] }),
  ]) {
    assert.equal(assessControlledSourceBasketReadiness(value).status, 'structural-fail')
  }
  const malicious = observation('plus')
  Object.defineProperty(malicious.provenance, 'capturedAt', {
    get() { throw new Error('PRIVATE_PARTICIPANT_KEY') },
  })
  const result = assessControlledSourceBasketReadiness(input({
    baselineObservations: [malicious],
  }))
  assert.equal(result.status, 'structural-fail')
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PARTICIPANT_KEY/)
})

test('M3 preparation rejects noncanonical one-ingredient plans and swapped/other store roles', () => {
  const oneDemandOnly = assessM3ControlledPlusDekaBasketReadiness(input())
  assert.equal(oneDemandOnly.status, 'structural-fail')
  assert.equal(oneDemandOnly.releaseEligible, false)

  const switched = input({
    baselineStore: candidateStore,
    candidateStore: baselineStore,
    baselineObservations: [observation('dekamarkt')],
    candidateObservations: [observation('plus')],
  })
  assert.equal(assessControlledSourceBasketReadiness(switched).status, 'structural-pass')
  assert.equal(assessM3ControlledPlusDekaBasketReadiness(switched).status, 'structural-fail')

  const ah = observation('ah', {
    provenance: {
      supermarket: 'ah',
      kind: 'product',
      url: 'https://www.ah.nl/synthetic-rice',
      capturedAt: referenceTime,
      sha256: 'f'.repeat(64),
    },
  })
  const otherRetailer = input({
    baselineStore: { id: 'source-ah', supermarket: 'ah' },
    baselineObservations: [ah],
  })
  assert.equal(assessControlledSourceBasketReadiness(otherRetailer).status, 'structural-pass')
  assert.equal(assessM3ControlledPlusDekaBasketReadiness(otherRetailer).status, 'structural-fail')
})

test('M3 retailer-order preflight safely rejects malformed or getter-backed identities without leaking values', () => {
  for (const candidate of [null, [], {}, { ...input(), baselineStore: null },
    { ...input(), candidateStore: { ...candidateStore, supermarket: 'plus' } },
  ]) {
    assert.equal(assessM3ControlledPlusDekaBasketReadiness(candidate).status, 'structural-fail')
  }

  const store = { id: 'source-plus' }
  Object.defineProperty(store, 'supermarket', {
    get() { throw new Error('SECRET_SOURCE_CONTEXT') },
  })
  const result = assessM3ControlledPlusDekaBasketReadiness(input({ baselineStore: store }))
  assert.equal(result.status, 'structural-fail')
  assert.doesNotMatch(JSON.stringify(result), /SECRET_SOURCE_CONTEXT/)
})

test('two distinct ingredients selecting one source SKU cannot be double-charged as complete', () => {
  const separateDemandNamesOneProduct = [{
    ...recipes[0],
    ingredients: [
      ...recipes[0].ingredients,
      {
        id: 'rice-additional-usage',
        label: 'Basmati rijst voor saus',
        query: 'basmati rijst',
        amount: 300, unit: 'g',
      },
    ],
  }]
  // Both distinct ingredient IDs would match the same single SKU at each
  // retailer. 2 × one pack is NOT the validated shared purchase quantity.
  const result = assessControlledSourceBasketReadiness(input({
    recipes: separateDemandNamesOneProduct,
  }))
  assert.deepEqual(result, {
    status: 'structural-fail',
    releaseEligible: false,
    reason: 'source-or-plan-not-comparable',
    comparison: null,
  })
  assert.equal(assessM3ControlledPlusDekaBasketReadiness(input({
    recipes: separateDemandNamesOneProduct,
  })).status, 'structural-fail')
})

test('reuse of the same ingredient ID across two planned days is still aggregated once', () => {
  const result = assessControlledSourceBasketReadiness(input({
    plan: [{ day: 'Ma', recipeId: 'rice' }, { day: 'Di', recipeId: 'rice' }],
    activeDays: ['Ma', 'Di'],
  }))
  assert.equal(result.status, 'structural-pass')
  assert.equal(result.baseline.lines.length, 1)
  assert.equal(result.baseline.lines[0].requirement.amount, 900)
  assert.equal(result.baseline.lines[0].packs, 1)
  assert.equal(result.candidate.lines[0].pack.count, 6)
  assert.equal(result.candidate.lines[0].packs, 1)
})
