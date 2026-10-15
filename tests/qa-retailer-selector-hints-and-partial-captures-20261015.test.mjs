import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  proposeRetailerSelectors,
  proposeFromM1CaptureDirectory,
} from '../scripts/retailer-snapshot-selector-proposals.mjs'

const html = '<!DOCTYPE html><body><div class="product-name">secret fake name</div>' +
  '<div class="product-price">1.95</div><span class="product-complementary">1 liter</span>' +
  '<div class="promo-offer">secret offer</div><span class="availability-stock">available</span></body>'
const capture = {
  id: 'qa-plus-product', supermarket: 'plus', kind: 'product',
  requestedUrl: 'https://www.plus.nl/product/example-123',
  capturedAt: '2026-10-15T13:00:00Z',
  sha256: createHash('sha256').update(html).digest('hex'),
  success: true,
}
test('field hints explain how AI could review name/price/pack/offer/stock selectors without claiming parser truth', () => {
  const result = proposeRetailerSelectors(capture, html)
  for (const [field, expected] of [
    ['name', 'div.product-name'],
    ['price', 'div.product-price'],
    ['package', 'span.product-complementary'],
    ['offer', 'div.promo-offer'],
    ['availability', 'span.availability-stock'],
  ]) {
    assert.ok(result.possibleFieldSelectors[field].some(x => x.selector === expected))
    assert.ok(result.possibleFieldSelectors[field].every(x => x.status === 'UNVERIFIED_FIELD_HINT' && x.reviewerMustVerifySemantics))
  }
  const report = JSON.stringify(result)
  assert.doesNotMatch(report, /secret fake name|secret offer|1\.95/)
  assert.equal(result.readyForScraping, false)
  assert.equal(result.currentPricesExtracted, false)
})

test('partially blocked real M1 capture is visible as UNAVAILABLE, not a fake valid selector', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-partial-m1-'))
  try {
    await mkdir(join(dir, 'plus'))
    await writeFile(join(dir, 'plus', 'qa-plus-product.html'), html)
    const failed = {
      id: 'qa-deka-offers', supermarket: 'dekamarkt', kind: 'offers',
      requestedUrl: 'https://www.dekamarkt.nl/aanbiedingen',
      capturedAt: '2026-10-15T13:00:00Z', success: false,
    }
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({
      sourceCount: 2, successCount: 1, failureCount: 1,
      results: [capture, failed],
    }))
    const r = await proposeFromM1CaptureDirectory(dir)
    assert.equal(r.analyzedSources, 2)
    assert.ok(r.selectorSets[0].proposedSelectors.length >= 4)
    assert.deepEqual(r.selectorSets[1], {
      sourceId: 'qa-deka-offers', status: 'CAPTURE_UNAVAILABLE',
      reason: 'not a successful authorized capture',
    })
    assert.equal(r.productionEnabled, false)
    assert.equal(r.automatedSelectorPromotion, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
