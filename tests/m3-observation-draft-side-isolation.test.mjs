import assert from 'node:assert/strict'
import test from 'node:test'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

function ownedObjects(value, found = new Set()) {
  if (value === null || typeof value !== 'object' || found.has(value)) {
    return found
  }

  found.add(value)
  for (const child of Object.values(value)) {
    ownedObjects(child, found)
  }
  return found
}

function assertNoSharedObjects(left, right, description) {
  const leftObjects = ownedObjects(left)
  const rightObjects = ownedObjects(right)

  for (const object of leftObjects) {
    assert.equal(
      rightObjects.has(object),
      false,
      `M3 ${description} must not share a mutable object across independent drafts`,
    )
  }
}

test('M3 PLUS and DekaMarkt collection sides have disjoint mutable object graphs', () => {
  const sheet = buildObservationSheet()

  assert.equal(sheet.requirements.length, 11)
  assert.equal(sheet.baseline.lines.length, 11)
  assert.equal(sheet.candidate.lines.length, 11)

  assertNoSharedObjects(sheet.baseline, sheet.candidate, 'store observations')
  assertNoSharedObjects(sheet.requirements, sheet.baseline, 'requirements and PLUS')
  assertNoSharedObjects(sheet.requirements, sheet.candidate, 'requirements and DekaMarkt')

  const untouchedCandidate = structuredClone(sheet.candidate)
  const untouchedRequirements = structuredClone(sheet.requirements)

  sheet.baseline.lines[0].ingredientLabel = 'MUTATED PLUS ingredient'
  sheet.baseline.lines[0].requirement.amount = 999999
  sheet.baseline.lines[0].observedProduct.productName = 'MUTATED PLUS product'
  sheet.baseline.lines[0].observedProduct.available = true
  sheet.baseline.lines[0].observedProduct.priceCents = 12345
  sheet.baseline.store.name = 'MUTATED PLUS store'

  assert.deepEqual(sheet.candidate, untouchedCandidate)
  assert.deepEqual(sheet.requirements, untouchedRequirements)
  assert.equal(sheet.evidenceStatus, 'collection-template-not-evidence')
})

test('M3 canonical requirement edits in one draft never rewrite either store demand', () => {
  const sheet = buildObservationSheet()
  const baselineBefore = structuredClone(sheet.baseline)
  const candidateBefore = structuredClone(sheet.candidate)

  sheet.requirements[0].id = 'tampered-ingredient'
  sheet.requirements[0].amount = 987654
  sheet.requirements[0].query = 'tampered query'

  assert.deepEqual(sheet.baseline, baselineBefore)
  assert.deepEqual(sheet.candidate, candidateBefore)
  assert.equal(sheet.evidenceStatus, 'collection-template-not-evidence')
})
