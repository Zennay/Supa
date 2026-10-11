import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  restoreObservationSheetDraft,
  observationSheetProgress,
  observationSheetReadiness,
} from '../src/domain/m3ObservationSheet.ts'

const SIDES = ['baseline', 'candidate']
const EMPTY = {
  productId: '',
  productName: '',
  packAmount: null,
  packUnit: null,
  packCount: 1,
  priceCents: null,
  available: null,
  sourceUrl: '',
  note: '',
}

function stampedProduct(side, index, available) {
  return {
    productId: `synthetic-${side}-${index}`,
    productName: `Synthetic QA item ${index}`,
    packAmount: 500,
    packUnit: 'g',
    packCount: 2,
    priceCents: 0,
    available,
    sourceUrl: 'https://example.invalid/qa-only',
    note: 'Synthetic fixture; not observed retail price',
  }
}

test('M3 restored false/null availability drops stale product money on every line', () => {
  let probes = 0
  for (const side of SIDES) {
    for (let index = 0; index < 11; index++) {
      for (const available of [false, null]) {
        const sheet = buildObservationSheet()
        sheet[side].lines[index].observedProduct = stampedProduct(side, index, available)

        const restored = restoreObservationSheetDraft(JSON.stringify(sheet))
        assert.ok(restored)
        assert.deepEqual(
          restored[side].lines[index].observedProduct,
          { ...EMPTY, available },
          `${side} line ${index}: stale price/pack/identity must be erased if unavailable or unknown`,
        )
        const other = side === 'baseline' ? 'candidate' : 'baseline'
        assert.deepEqual(restored[other].lines[index].observedProduct, EMPTY)
        assert.equal(restored.evidenceStatus, 'collection-template-not-evidence')
        probes++
      }
    }
  }
  assert.equal(probes, 44)
})

test('M3 restored true availability preserves zero-cent synthetic input without swapping stores', () => {
  let probes = 0
  for (const side of SIDES) {
    for (let index = 0; index < 11; index++) {
      const sheet = buildObservationSheet()
      const item = stampedProduct(side, index, true)
      sheet[side].lines[index].observedProduct = item

      const restored = restoreObservationSheetDraft(JSON.stringify(sheet))
      assert.ok(restored)
      assert.deepEqual(restored[side].lines[index].observedProduct, item)
      const other = side === 'baseline' ? 'candidate' : 'baseline'
      assert.deepEqual(restored[other].lines[index].observedProduct, EMPTY)
      assert.equal(observationSheetProgress(restored).completeLines, 1)
      assert.equal(observationSheetReadiness(restored).ready, false)
      assert.equal(restored.evidenceStatus, 'collection-template-not-evidence')
      probes++
    }
  }
  assert.equal(probes, 22)
})

test('M3 recovery eliminates injected evidence promotion, private expansion and window overrides', () => {
  const template = buildObservationSheet()
  const fields = [
    ['schemaVersion', 2],
    ['sheetType', 'verified-retailer-evidence'],
    ['evidenceStatus', 'verified-retailer-evidence'],
    ['plannerFixture', 'different-week'],
    ['selectedMealCount', template.selectedMealCount + 1],
  ]

  for (const [key, unsafe] of fields) {
    const edited = JSON.parse(JSON.stringify(template))
    edited[key] = unsafe
    assert.equal(
      restoreObservationSheetDraft(JSON.stringify(edited)),
      null,
      `Unsupported ${key} must not be loaded as M3 collection evidence`,
    )
  }

  const injected = JSON.parse(JSON.stringify(template))
  injected.study.maxObservationWindowHours = 48
  injected.unverifiedSavingsCents = 999999
  injected.baseline.unverifiedSavingsCents = 999999
  injected.candidate.unverifiedSavingsCents = 999999
  const restored = restoreObservationSheetDraft(JSON.stringify(injected))

  assert.ok(restored)
  assert.equal(restored.study.maxObservationWindowHours, 24)
  assert.equal(Object.hasOwn(restored, 'unverifiedSavingsCents'), false)
  assert.equal(Object.hasOwn(restored.baseline, 'unverifiedSavingsCents'), false)
  assert.equal(Object.hasOwn(restored.candidate, 'unverifiedSavingsCents'), false)
  assert.equal(restored.evidenceStatus, 'collection-template-not-evidence')
})
