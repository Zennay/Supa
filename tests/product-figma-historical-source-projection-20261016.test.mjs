import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { historicalRetailerProducts, filterHistoricalProducts } from '../src/features/products/historicalRetailerProducts.ts'

const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))

test('Figma source projection exactly matches PLUS/Deka archived product identities without prices', () => {
  const plus = readJson('../fixtures/m1/plus-rendered-catalog.v1.json')
  const deka = readJson('../fixtures/m1/dekamarkt-product-halfvolle-melk.v1.json')
  const cards = plus.cards
  assert.equal(plus.source.supermarket, 'plus')
  assert.equal(deka.source.supermarket, 'dekamarkt')
  assert.equal(plus.source.kind, 'catalog')
  assert.equal(deka.source.kind, 'product')
  assert.equal(historicalRetailerProducts.length, cards.length + 1)
  for (const [index, card] of cards.entries()) {
    const item = historicalRetailerProducts[index]
    assert.equal(item.store, 'PLUS')
    assert.equal(item.name, card.name)
    assert.equal(item.pack, card.packText)
    assert.equal(item.sourceUrl, new URL(card.href, 'https://www.plus.nl').href)
    assert.equal(item.capturedAt, plus.source.capturedAt)
    assert.equal(item.price, null)
    assert.equal(item.status, 'historical-source-only')
    assert.ok(Object.isFrozen(item))
  }
  const dekaItem = historicalRetailerProducts.at(-1)
  assert.equal(dekaItem.store, 'DekaMarkt')
  assert.equal(dekaItem.name, deka.jsonLdProduct.name)
  assert.equal(dekaItem.sourceUrl, deka.source.url)
  assert.equal(dekaItem.capturedAt, deka.source.capturedAt)
  assert.equal(dekaItem.price, null)
  assert.equal(dekaItem.status, 'historical-source-only')
  assert.ok(Object.isFrozen(historicalRetailerProducts))
})

test('historical identity browser module has no price import, offer field or retailer networking', () => {
  const code = readFileSync(new URL('../src/features/products/historicalRetailerProducts.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(code, /import\s+.*?(fixtures\/m1|fetch\(|XMLHttpRequest)/)
  assert.equal(filterHistoricalProducts(historicalRetailerProducts, 'melk', 'DekaMarkt').length, 1)
  assert.equal(filterHistoricalProducts(historicalRetailerProducts, 'bananen', 'PLUS').length, 1)
  assert.equal(filterHistoricalProducts(historicalRetailerProducts, '', 'all').length, 5)
  assert.equal(filterHistoricalProducts(historicalRetailerProducts, 'unknown', 'all').length, 0)
})
