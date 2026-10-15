import assert from 'node:assert/strict'
import test from 'node:test'
import { structuredSchemaOrgPack } from '../src/data/schemaOrgQuantitativePack.ts'
import { parseSchemaOrgProductForPage } from '../src/data/schemaOrgProductPageSelection.ts'

// Pure synthetic offline Schema.org shapes; no retailer HTTP or price evidence.
const SOURCE = {
  supermarket: 'plus', kind: 'product',
  url: 'https://www.plus.nl/product/fictional-structured-pack',
  capturedAt: '2026-10-14T12:00:00Z',
  sha256: 'c'.repeat(64),
}
function fictionalProduct(quantity) {
  return {
    '@context': 'https://schema.org', '@type': 'Product',
    url: SOURCE.url,
    name: 'Fictief product',
    sku: 'FICTIONAL-ITEM',
    ...quantity,
    offers: {
      '@type': 'Offer', price: '1.25', priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
    },
  }
}
function accepted(input) {
  const result = parseSchemaOrgProductForPage(input, SOURCE)
  assert.equal(result.type, 'observation', JSON.stringify(result))
  return result.observation
}

test('Schema.org weight GRM value normalizes precisely to grams', () => {
  const original = fictionalProduct({
    weight: { '@type': 'QuantitativeValue', value: 500, unitCode: 'GRM' },
  })
  const before = JSON.stringify(original)
  const observation = accepted(original)
  assert.equal(observation.pack.amount, 500)
  assert.equal(observation.pack.unit, 'g')
  assert.equal(observation.currentPriceCents, 125)
  assert.equal(JSON.stringify(original), before, 'source fixture never mutated')
})

test('KGM decimal and string amounts preserve actual mass', () => {
  const kg = accepted(fictionalProduct({
    weight: { '@type': 'QuantitativeValue', value: '0.75', unitCode: 'KGM' },
  }))
  assert.equal(kg.pack.amount, 0.75)
  assert.equal(kg.pack.unit, 'kg')
})

test('Schema.org size MLT and LTR preserve volume without guessed text', () => {
  for (const [unitCode, amount, expectedUnit] of [
    ['MLT', 400, 'ml'],
    ['LTR', 1.5, 'l'],
  ]) {
    const row = accepted(fictionalProduct({
      size: { '@type': 'QuantitativeValue', value: amount, unitCode },
    }))
    assert.equal(row.pack.amount, amount)
    assert.equal(row.pack.unit, expectedUnit)
  }
})

test('explicit size C62 maps each to physical pieces, not mass', () => {
  const row = accepted(fictionalProduct({
    size: { value: 2, unitCode: 'C62' },
  }))
  assert.equal(row.pack.amount, 2)
  assert.equal(row.pack.unit, 'piece')
})

test('no explicit standard unit remains unknown, never fabricates a package', () => {
  const original = fictionalProduct({ size: { value: 500 } })
  assert.deepEqual(structuredSchemaOrgPack(original), { status: 'none' })
  const observation = accepted(original)
  assert.equal(observation.pack.amount, null)
  assert.equal(observation.pack.unit, 'unknown')
})

test('conflicting simultaneous size and weight cannot be treated as one pack', () => {
  const product = fictionalProduct({
    weight: { value: 1, unitCode: 'KGM' },
    size: { value: 250, unitCode: 'MLT' },
  })
  assert.equal(structuredSchemaOrgPack(product).status, 'unsafe')
  const result = parseSchemaOrgProductForPage(product, SOURCE)
  assert.equal(result.type, 'abstain')
  assert.match(result.reason, /ambiguous physical packaging/)
})

test('noncanonical unit codes and physically wrong units fail closed', () => {
  for (const value of [
    { weight: { value: 500, unitCode: 'MLT' } },
    { weight: { value: 500, unitCode: 'grams' } },
    { size: { value: 500, unitCode: 'unknown' } },
    { size: { value: 1, unitCode: ['LTR'] } },
  ]) {
    const result = parseSchemaOrgProductForPage(fictionalProduct(value), SOURCE)
    assert.equal(result.type, 'abstain')
    assert.match(result.reason, /ambiguous physical packaging/)
  }
})

test('unsafe negative, zero, nonfinite, oversized and exotic numeric amounts abstain', () => {
  for (const value of [0, -1, Infinity, NaN, '1,5', '1e9', '99999999', '1.00000', {}]) {
    const result = parseSchemaOrgProductForPage(fictionalProduct({
      weight: { value, unitCode: 'GRM' },
    }), SOURCE)
    assert.equal(result.type, 'abstain', String(value))
  }
})

test('a Product recommended elsewhere cannot supply the selected package', () => {
  const target = fictionalProduct({
    weight: { value: 500, unitCode: 'GRM' },
  })
  const unrelated = {
    ...fictionalProduct({ weight: { value: 1, unitCode: 'KGM' } }),
    url: 'https://www.plus.nl/product/fictional-recommendation',
  }
  const result = parseSchemaOrgProductForPage({
    '@graph': [unrelated, target],
  }, SOURCE)
  assert.equal(result.type, 'observation')
  assert.equal(result.observation.pack.amount, 500)
  assert.equal(result.observation.pack.unit, 'g')
})

test('hostile QuantitativeValue getters are rejected without leaking values', () => {
  const poison = { unitCode: 'GRM' }
  Object.defineProperty(poison, 'value', {
    get() { throw new Error('PRIVATE_QUANTITY_SECRET') },
  })
  const result = parseSchemaOrgProductForPage(fictionalProduct({
    weight: poison,
  }), SOURCE)
  assert.equal(result.type, 'abstain')
  assert.doesNotMatch(result.reason, /PRIVATE_QUANTITY_SECRET/)
})
