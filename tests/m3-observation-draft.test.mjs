import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'

test('M3 local draft recovery restores genuine editable collection fields', () => {
  const sheet = buildObservationSheet()
  sheet.study.studyId = 'm3-week-001'
  sheet.study.participantKey = 'student-001'
  sheet.baseline.store.name = 'Observed store A'
  sheet.baseline.lines[0].observedProduct.available = true
  sheet.baseline.lines[0].observedProduct.productName = 'Observed chicken'
  sheet.baseline.lines[0].observedProduct.packAmount = 600
  sheet.baseline.lines[0].observedProduct.packUnit = 'g'
  sheet.baseline.lines[0].observedProduct.priceCents = 499

  const restored = restoreObservationSheetDraft(JSON.stringify(sheet))

  assert.ok(restored)
  assert.equal(restored.study.studyId, 'm3-week-001')
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
