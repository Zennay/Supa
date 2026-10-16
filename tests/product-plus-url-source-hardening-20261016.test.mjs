import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePlus } from '../scraper/adapters/plus.mjs'

const ARTICLE = 'https://www.plus.nl/producten/synthetic-oats-12345'
function html(link) {
  const product = {
    '@context': 'https://schema.org', '@type': 'Product',
    name: 'Imaginary oats', sku: '12345',
    offers: { price: '2.49', priceCurrency: 'EUR' },
  }
  if (link !== null) product.url = link
  return '<script type="application/ld+json">' + JSON.stringify(product) + '</script>'
}
test('PLUS exact article path with harmless source query remains admissible', () => {
  assert.equal(parsePlus(html(ARTICLE), ARTICLE + '?fixture=1').length, 1)
})
for (const source of ['http://www.plus.nl/producten/synthetic-oats-12345', 'https://www.plus.nl.attacker.invalid/producten/synthetic-oats-12345', 'https://user@www.plus.nl/producten/synthetic-oats-12345']) {
  test('PLUS URL must be actual approved HTTPS host without embedded credentials: ' + source, () => {
    assert.deepEqual(parsePlus(html(null), source), [])
  })
}
for (const link of ['http://www.plus.nl/producten/synthetic-oats-12345', 'https://www.plus.nl.attacker.invalid/producten/synthetic-oats-12345', 'https://user@www.plus.nl/producten/synthetic-oats-12345']) {
  test('PLUS conflicting declared Product.url never claims observed price: ' + link, () => {
    assert.deepEqual(parsePlus(html(link), ARTICLE), [])
  })
}
