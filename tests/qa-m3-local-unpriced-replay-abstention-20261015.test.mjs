import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareLocalRetailerSnapshots } from '../scripts/retailer-compare-local-snapshots.mjs'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// Independent QA 2/2: strictly fictional, offline-only source documents.
// Do not turn a product without checkout price into a "priced capture".
const clock = Date.parse('2026-10-15T11:00:00Z')
const capturedAt = '2026-10-15T10:00:00Z'
const ids = ['plus-product-halfvolle-melk', 'dekamarkt-product-halfvolle-melk']
const milk = {
  '@context': 'https://schema.org', '@type': 'Product',
  sku: 'fictional-test-milk', name: 'Halfvolle melk',
  weight: { value: '1000 ml' },
}
const html = product => '<script type="application/ld+json">' +
  JSON.stringify(product) + '</script>'
const noCheckoutPrice = html({
  ...milk, offers: { '@type': 'Offer', priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock' },
})
const indicativeRangeOnly = html({
  ...milk, offers: { '@type': 'AggregateOffer', lowPrice: '0.59',
    highPrice: '1.99', priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock' },
})
const exactPrice = html({
  ...milk, offers: { '@type': 'Offer', price: '1.29',
    priceCurrency: 'EUR', availability: 'https://schema.org/InStock' },
})
const noProduct = '<html><body>Mock page: no shop price available</body></html>'
const demand = [{ id: 'milk', query: 'halfvolle melk', amount: 1000, unit: 'ml' }]

async function offlinePair(t, plusHtml, dekaHtml, reuseFilename = false) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-unpriced-snapshot-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'plus.html'), plusHtml)
  if (!reuseFilename) await writeFile(join(dir, 'deka.html'), dekaHtml)
  const manifest = {
    version: 1, requirements: demand,
    snapshots: ids.map((sourceId, index) => ({
      sourceId, htmlFile: index === 0 || reuseFilename ? 'plus.html' : 'deka.html',
      capturedAt,
    })),
  }
  const filepath = join(dir, 'manifest.json')
  await writeFile(filepath, JSON.stringify(manifest))
  return { filepath, manifest }
}

function assertNoMoney(result, expectedProducts) {
  assert.equal(result.comparison.claimable, false)
  assert.equal(result.comparison.comparable, false)
  assert.equal(result.comparison.cheaperStore, null)
  assert.equal(result.comparison.savingsCents, null)
  assert.deepEqual(result.captureSummary.map(row => row.parsedProducts), expectedProducts)
}

for (const [name, page] of [
  ['missing checkout price', noCheckoutPrice],
  ['AggregateOffer lowPrice is not a checkout pack price', indicativeRangeOnly],
]) {
  test('source parser preserves an unpriced Product, not a usable checkout quote: ' + name, () => {
    const source = SOURCES.find(row => row.id === ids[0])
    const parsed = parseOfflineRetailerSnapshot({ source, html: page, capturedAt })
    assert.equal(parsed.observations.length, 1)
    assert.equal(parsed.observations[0].currentPriceCents, null)
  })

  for (const reverse of [false, true]) {
    test('IDENTICAL unpriced Product across retail labels must yield a safe unknown result: ' +
      name + ', reverse=' + reverse, async t => {
      const input = await offlinePair(t, page, page)
      if (reverse) input.manifest.snapshots.reverse()
      await writeFile(input.filepath, JSON.stringify(input.manifest))
      const result = await compareLocalRetailerSnapshots(input.filepath, clock)
      assertNoMoney(result, [1, 1])
      assert.equal(result.captureSummary[0].sha256, result.captureSummary[1].sha256)
    })
  }
}

test('identical page with NO Product remains safe and money-free', async t => {
  const input = await offlinePair(t, noProduct, noProduct)
  assertNoMoney(await compareLocalRetailerSnapshots(input.filepath, clock), [0, 0])
})

test('IDENTICAL priced Product replay still must reject cross-retailer evidence', async t => {
  const input = await offlinePair(t, exactPrice, exactPrice)
  await assert.rejects(
    compareLocalRetailerSnapshots(input.filepath, clock),
    /Duplicate priced offline HTML capture reused across sources/,
  )
})

test('same physical capture filename remains forbidden even if HTML is unpriced', async t => {
  const input = await offlinePair(t, noCheckoutPrice, noCheckoutPrice, true)
  await assert.rejects(
    compareLocalRetailerSnapshots(input.filepath, clock),
    /Invalid or duplicate offline snapshot reference/,
  )
})
