import assert from 'node:assert/strict'
import test from 'node:test'
import { structuredSchemaOrgPack } from '../src/data/schemaOrgQuantitativePack.ts'
import { parseSchemaOrgProductForPage } from '../src/data/schemaOrgProductPageSelection.ts'

const SOURCE = {
  supermarket: 'dekamarkt', kind: 'product',
  url: 'https://www.dekamarkt.nl/producten/fictional-oat-milk',
  capturedAt: '2026-10-14T12:00:00Z', sha256: 'e'.repeat(64),
}
function product(pack) {
  return {
    '@type': 'Product', url: SOURCE.url, name: 'Fictieve havermelk',
    sku: 'SYNTHETIC-OAT', ...pack,
    offers: {
      '@type': 'Offer', price: '1.80', priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
    },
  }
}
function read(pack) {
  return parseSchemaOrgProductForPage(product(pack), SOURCE)
}

test('explicit Dutch gram unitText yields a physical 500g pack with original EUR price', () => {
  const row = read({ weight: { '@type': 'QuantitativeValue', value: 500, unitText: 'gram' } })
  assert.equal(row.type, 'observation')
  assert.equal(row.observation.pack.amount, 500)
  assert.equal(row.observation.pack.unit, 'g')
  assert.equal(row.observation.currentPriceCents, 180)
  assert.equal(row.observation.provenance.url, SOURCE.url)
})

test('kilogram and decimal mass unitText are physical, never rounded to grams by guess', () => {
  for (const [word, amount] of [['kilogram', '0.75'], ['kg', 1.5], ['GRAMS', 250]]) {
    const row = read({ weight: { value: amount, unitText: word } })
    assert.equal(row.type, 'observation', word)
    assert.equal(row.observation.pack.amount, Number(amount))
    assert.equal(row.observation.pack.unit, word.toLowerCase() === 'grams' ? 'g' : 'kg')
  }
})

test('ml and liter unitText return trusted liquid packages, not unknown units', () => {
  for (const [word, amount, unit] of [
    ['ml', 250, 'ml'],
    ['milliliter', 500, 'ml'],
    ['millilitre', 330, 'ml'],
    ['liter', 1.5, 'l'],
    ['litre', 1, 'l'],
    ['L', 2, 'l'],
  ]) {
    const row = read({ size: { value: amount, unitText: word } })
    assert.equal(row.type, 'observation', word)
    assert.equal(row.observation.pack.amount, amount)
    assert.equal(row.observation.pack.unit, unit)
  }
})

test('Dutch stuks and English piece correctly express discrete pack count', () => {
  for (const word of ['stuk', 'stuks', 'pieces', 'piece', 'st']) {
    const row = read({ size: { value: 2, unitText: word } })
    assert.equal(row.type, 'observation', word)
    assert.equal(row.observation.pack.amount, 2)
    assert.equal(row.observation.pack.unit, 'piece')
  }
})

test('matching unitCode plus unitText is accepted and does not mutate JSON-LD', () => {
  const input = product({ size: { value: 1, unitCode: 'LTR', unitText: 'liter' } })
  const original = JSON.stringify(input)
  const row = parseSchemaOrgProductForPage(input, SOURCE)
  assert.equal(row.type, 'observation')
  assert.equal(row.observation.pack.amount, 1)
  assert.equal(row.observation.pack.unit, 'l')
  assert.equal(JSON.stringify(input), original)
})

test('contradictory explicit unitCode and unitText always fail closed', () => {
  for (const pack of [
    { weight: { value: 500, unitCode: 'KGM', unitText: 'gram' } },
    { size: { value: 2, unitCode: 'C62', unitText: 'ml' } },
    { size: { value: 1, unitCode: 'LTR', unitText: 'stuks' } },
  ]) {
    const row = read(pack)
    assert.equal(row.type, 'abstain')
    assert.match(row.reason, /ambiguous physical packaging/)
  }
})

test('unknown retail text, non-whitelisted metric labels and discount descriptions abstain', () => {
  for (const word of ['fl oz', 'gram per portie', 'pak', 'zakje', '1000ml', '1 + 1 gratis', 'ltr.', 'each', 'g/100ml', '']) {
    const row = read({ size: { value: 1, unitText: word } })
    assert.equal(row.type, 'abstain', word)
  }
})

test('weight cannot borrow volume or count even with explicit valid unitText', () => {
  for (const word of ['ml', 'liter', 'stuks']) {
    assert.equal(read({ weight: { value: 250, unitText: word } }).type, 'abstain')
  }
})

test('missing both unit fields stays unknown, a non-null malformed field refuses', () => {
  assert.deepEqual(structuredSchemaOrgPack(product({ size: { value: 100 } })),
    { status: 'none' })
  assert.equal(read({ size: { value: 100 } }).observation.pack.unit, 'unknown')
  for (const field of [
    { unitText: null },
    { unitText: 20 },
    { unitCode: null, unitText: 'gram' },
    { unitCode: 'KGM', unitText: 'fake' },
  ]) {
    assert.equal(read({ size: { value: 100, ...field } }).type, 'abstain')
  }
})

test('hostile unitText getter never prints private source field and never authorizes saving', () => {
  const size = { value: 500 }
  Object.defineProperty(size, 'unitText', {
    get() { throw new Error('PRIVATE_PERSONAL_SOURCE_VALUE_985') },
  })
  const row = read({ size })
  assert.equal(row.type, 'abstain')
  assert.doesNotMatch(row.reason, /PRIVATE_PERSONAL_SOURCE_VALUE_985/)
})
