import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  nextIncompleteObservationLine,
  observationSheetProgress,
  observationStoreMatchesExpectedRetailer,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'

// Test-driven QA acceptance for open #1046 and #1048.
// Intentionally fail on the known current implementation until the M3
// observation-source owner fixes the fail-open behavior; never weaken the
// expectations or mark these malicious values as legitimate observations.
test('retailer names require a legitimate brand token, not substring impersonation (#1046)', () => {
  const accepted = [
    ['baseline', 'PLUS'],
    ['baseline', 'PLUS Leiden'],
    ['candidate', 'DekaMarkt'],
    ['candidate', 'Deka Markt'],
    ['candidate', 'DekaMarkt Haarlem'],
  ]
  for (const [side, label] of accepted) {
    assert.equal(observationStoreMatchesExpectedRetailer(side, label), true, label)
  }
  const spoofed = [
    ['baseline', 'NotPLUS'],
    ['baseline', 'PLUS DekaMarkt fake'],
    ['candidate', 'NotDekaMarkt'],
    ['candidate', 'SuperDekaMarktFake'],
    ['candidate', 'dekamarktish'],
    ['candidate', 'PLUS DekaMarkt fake'],
  ]
  for (const [side, label] of spoofed) {
    assert.equal(observationStoreMatchesExpectedRetailer(side, label), false,
      `reject embedded or contradictory retailer identity: ${side} / ${label}`)
  }
})

test('available item with invalid saved packCount must not become a complete field observation (#1048)', () => {
  for (const packCount of [0, -3, 1.5, Number.MAX_SAFE_INTEGER + 1, '2', null]) {
    const sheet = buildObservationSheet()
    const line = sheet.baseline.lines[0]
    Object.assign(line.observedProduct, {
      productId: 'synthetic-item',
      productName: 'Synthetic product — not retail evidence',
      available: true,
      packAmount: 500,
      packUnit: 'g',
      packCount,
      priceCents: 199,
    })
    const restored = restoreObservationSheetDraft(JSON.stringify(sheet))
    if (restored === null) continue // Rejecting the draft entirely is safe.
    const progress = observationSheetProgress(restored)
    const nextTask = nextIncompleteObservationLine(restored)
    assert.equal(progress.completeLines, 0,
      `malformed persisted packCount ${String(packCount)} cannot become a complete item`)
    assert.deepEqual(nextTask, {
      side: 'baseline',
      ingredientId: line.ingredientId,
    })
    assert.equal(restored.evidenceStatus, 'collection-template-not-evidence')
  }
})

test('valid observed pack counts survive, and unavailable products do not preserve stale details', () => {
  for (const packCount of [1, 2, 8]) {
    const sheet = buildObservationSheet()
    Object.assign(sheet.baseline.lines[0].observedProduct, {
      productName: 'Synthetic example',
      available: true,
      packAmount: 500,
      packUnit: 'g',
      packCount,
      priceCents: 199,
    })
    const restored = restoreObservationSheetDraft(JSON.stringify(sheet))
    assert.ok(restored)
    assert.equal(restored.baseline.lines[0].observedProduct.packCount, packCount)
    assert.equal(observationSheetProgress(restored).completeLines, 1)
    assert.equal(restored.evidenceStatus, 'collection-template-not-evidence')
  }

  const sheet = buildObservationSheet()
  Object.assign(sheet.baseline.lines[0].observedProduct, {
    productName: 'Stale synthetic product',
    available: false,
    packAmount: 500,
    packUnit: 'g',
    packCount: -3,
    priceCents: 199,
  })
  const restored = restoreObservationSheetDraft(JSON.stringify(sheet))
  assert.ok(restored)
  assert.equal(restored.baseline.lines[0].observedProduct.available, false)
  assert.equal(restored.baseline.lines[0].observedProduct.productName, '')
  assert.equal(restored.baseline.lines[0].observedProduct.priceCents, null)
})
