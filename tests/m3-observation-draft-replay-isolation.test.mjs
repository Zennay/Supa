import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'

test('M3 independently generated blank field sheets are deterministic and never reuse draft objects', () => {
  const original = buildObservationSheet()
  const canonicalJson = JSON.stringify(original)

  const second = buildObservationSheet()
  assert.notStrictEqual(original, second)
  assert.notStrictEqual(original.study, second.study)
  assert.notStrictEqual(original.requirements, second.requirements)
  assert.notStrictEqual(original.baseline.lines[0], second.baseline.lines[0])
  assert.notStrictEqual(
    original.candidate.lines[0].observedProduct,
    second.candidate.lines[0].observedProduct,
  )
  assert.equal(JSON.stringify(second), canonicalJson)

  original.study.participantKey = 'synthetic-qa-key'
  original.requirements[0].amount = 123456
  original.baseline.lines[0].observedProduct.priceCents = 999
  original.candidate.lines[0].observedProduct.available = false
  original.instructions.push('synthetic fixture mutation')

  assert.equal(JSON.stringify(second), canonicalJson)
  assert.equal(JSON.stringify(buildObservationSheet()), canonicalJson)
  assert.equal(second.evidenceStatus, 'collection-template-not-evidence')
  assert.equal(second.study.participantKey, '')
})

test('M3 JSON draft restore isolates stored PLUS edits from DekaMarkt and later templates', () => {
  const original = buildObservationSheet()
  original.baseline.lines[0].observedProduct = {
    ...original.baseline.lines[0].observedProduct,
    available: true,
    productName: 'Synthetic basket item',
    packAmount: 500,
    packUnit: 'g',
    priceCents: 199,
  }
  const beforeRestoreCandidate = structuredClone(original.candidate)
  const serialized = JSON.stringify(original)
  const restored = restoreObservationSheetDraft(serialized)

  assert.ok(restored, 'canonical local draft should restore without promotion to evidence')
  assert.equal(restored.evidenceStatus, 'collection-template-not-evidence')
  assert.equal(restored.baseline.lines[0].observedProduct.priceCents, 199)
  assert.deepEqual(restored.candidate, beforeRestoreCandidate)
  assert.notStrictEqual(restored.baseline.lines[0], original.baseline.lines[0])
  assert.notStrictEqual(restored.candidate.lines[0], original.candidate.lines[0])
  assert.notStrictEqual(restored.baseline.lines[0].requirement, restored.candidate.lines[0].requirement)

  restored.baseline.lines[0].observedProduct.priceCents = 888
  restored.baseline.lines[0].requirement.amount = 999
  assert.deepEqual(restored.candidate, beforeRestoreCandidate)
  assert.equal(original.baseline.lines[0].observedProduct.priceCents, 199)
  assert.equal(JSON.stringify(original), serialized)

  const nextBlank = buildObservationSheet()
  assert.equal(nextBlank.baseline.lines[0].observedProduct.priceCents, null)
  assert.equal(nextBlank.candidate.lines[0].observedProduct.priceCents, null)
  assert.equal(nextBlank.study.participantKey, '')
})
