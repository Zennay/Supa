import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  restoreObservationSheetDraft,
  withObservedProductAvailability,
} from '../src/domain/m3ObservationSheet.ts'

test('M3 local draft recovery restores genuine editable collection fields', () => {
  const sheet = buildObservationSheet()
  sheet.study.studyId = 'm3-week-001'
  sheet.study.participantKey = 'student-001'
  sheet.study.priceContext = 'online-order'
  sheet.baseline.store.name = 'Observed store A'
  sheet.baseline.lines[0].observedProduct.available = true
  sheet.baseline.lines[0].observedProduct.productName = 'Observed chicken'
  sheet.baseline.lines[0].observedProduct.packAmount = 600
  sheet.baseline.lines[0].observedProduct.packUnit = 'g'
  sheet.baseline.lines[0].observedProduct.priceCents = 499

  const restored = restoreObservationSheetDraft(JSON.stringify(sheet))

  assert.ok(restored)
  assert.equal(restored.study.studyId, 'm3-week-001')
  assert.equal(restored.study.priceContext, 'online-order')
  assert.equal(restored.baseline.store.name, 'Observed store A')
  assert.equal(restored.baseline.lines[0].observedProduct.productName, 'Observed chicken')
  assert.equal(restored.baseline.lines[0].observedProduct.priceCents, 499)
  assert.equal(restored.evidenceStatus, 'collection-template-not-evidence')
})

test('M3 local draft recovery fails closed on evidence-status promotion', () => {
  const sheet = buildObservationSheet()
  const unsafe = {
    ...sheet,
    evidenceStatus: 'verified-evidence',
  }

  assert.equal(restoreObservationSheetDraft(JSON.stringify(unsafe)), null)
})

test('M3 local draft recovery rejects planner-demand drift', () => {
  const sheet = buildObservationSheet()
  sheet.requirements[0].amount += 1

  assert.equal(restoreObservationSheetDraft(JSON.stringify(sheet)), null)
})

test('M3 local draft recovery rejects malformed JSON instead of crashing', () => {
  assert.equal(restoreObservationSheetDraft('{not-json'), null)
})

test('M3 local draft recovery sanitizes malformed editable product values', () => {
  const sheet = buildObservationSheet()
  const unsafe = JSON.parse(JSON.stringify(sheet))
  unsafe.baseline.lines[0].observedProduct.available = 'yes'
  unsafe.baseline.lines[0].observedProduct.packCount = -3
  unsafe.baseline.lines[0].observedProduct.priceCents = -99

  const restored = restoreObservationSheetDraft(JSON.stringify(unsafe))

  assert.ok(restored)
  assert.equal(restored.baseline.lines[0].observedProduct.available, null)
  assert.equal(restored.baseline.lines[0].observedProduct.packCount, 1)
  assert.equal(restored.baseline.lines[0].observedProduct.priceCents, null)
})


test('M3 local draft recovery sanitizes unsafe integer collection values', () => {
  const sheet = buildObservationSheet()
  sheet.baseline.lines[0].observedProduct.available = true
  sheet.baseline.lines[0].observedProduct.productName = 'Observed chicken'
  sheet.baseline.lines[0].observedProduct.packAmount = 600
  sheet.baseline.lines[0].observedProduct.packUnit = 'g'
  sheet.baseline.lines[0].observedProduct.packCount = Number.MAX_SAFE_INTEGER + 1
  sheet.baseline.lines[0].observedProduct.priceCents = Number.MAX_SAFE_INTEGER + 1

  const restored = restoreObservationSheetDraft(JSON.stringify(sheet))

  assert.ok(restored)
  assert.equal(restored.baseline.lines[0].observedProduct.packCount, 1)
  assert.equal(restored.baseline.lines[0].observedProduct.priceCents, null)
})

test('M3 availability reset clears stale observed product details', () => {
  const sheet = buildObservationSheet()
  const product = sheet.baseline.lines[0].observedProduct
  product.available = true
  product.productId = 'stale-id'
  product.productName = 'Stale product'
  product.packAmount = 500
  product.packUnit = 'g'
  product.packCount = 2
  product.priceCents = 399
  product.sourceUrl = 'https://example.invalid/product'
  product.note = 'stale note'

  const unavailable = withObservedProductAvailability(product, false)

  assert.deepEqual(unavailable, {
    productId: '',
    productName: '',
    packAmount: null,
    packUnit: null,
    packCount: 1,
    priceCents: null,
    available: false,
    sourceUrl: '',
    note: '',
  })
})

test('M3 draft recovery removes contradictory stale details from unavailable lines', () => {
  const sheet = buildObservationSheet()
  const product = sheet.baseline.lines[0].observedProduct
  product.available = false
  product.productId = 'stale-id'
  product.productName = 'Should not survive'
  product.packAmount = 500
  product.packUnit = 'g'
  product.packCount = 2
  product.priceCents = 399
  product.sourceUrl = 'https://example.invalid/product'
  product.note = 'stale note'

  const restored = restoreObservationSheetDraft(JSON.stringify(sheet))

  assert.ok(restored)
  assert.deepEqual(restored.baseline.lines[0].observedProduct, {
    productId: '',
    productName: '',
    packAmount: null,
    packUnit: null,
    packCount: 1,
    priceCents: null,
    available: false,
    sourceUrl: '',
    note: '',
  })
})
