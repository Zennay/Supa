import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'

function draftCopy() {
  return JSON.parse(JSON.stringify(buildObservationSheet()))
}

function changedValue(key, current) {
  if (key === 'amount') return current + 1
  if (key === 'unit') return current === 'g' ? 'ml' : 'g'
  return current + '-changed-by-qa'
}

test('M3 canonical requirements reject every index and identity/demand mutation', () => {
  const canonical = buildObservationSheet()
  const fields = ['id', 'label', 'query', 'amount', 'unit']
  let probes = 0

  for (let index = 0; index < canonical.requirements.length; index++) {
    for (const field of fields) {
      const mutated = draftCopy()
      const entry = mutated.requirements[index]
      entry[field] = changedValue(field, entry[field])
      assert.equal(
        restoreObservationSheetDraft(JSON.stringify(mutated)),
        null,
        `Canonical requirement ${index} / ${field} must invalidate the entire draft`,
      )
      probes++
    }
  }

  assert.equal(canonical.requirements.length, 11)
  assert.equal(probes, 55)
  assert.ok(restoreObservationSheetDraft(JSON.stringify(canonical)))
})

test('M3 both retailer sides reject mutated physical demand at all 22 positions', () => {
  const fields = ['ingredientId', 'ingredientLabel', 'amount', 'unit']
  let probes = 0

  for (const side of ['baseline', 'candidate']) {
    for (let index = 0; index < 11; index++) {
      for (const field of fields) {
        const mutated = draftCopy()
        const line = mutated[side].lines[index]
        const parent = field === 'amount' || field === 'unit'
          ? line.requirement
          : line
        parent[field] = changedValue(field, parent[field])

        assert.equal(
          restoreObservationSheetDraft(JSON.stringify(mutated)),
          null,
          `${side} physical line ${index}/${field} must not silently inherit canonical money or demand`,
        )
        probes++
      }
    }
  }

  assert.equal(probes, 88)
})

test('M3 saved requirements cannot be reordered, omitted or duplicated on either side', () => {
  for (const target of ['requirements', 'baseline', 'candidate']) {
    for (const kind of ['reverse', 'drop', 'duplicate']) {
      const mutated = draftCopy()
      const list = target === 'requirements'
        ? mutated.requirements
        : mutated[target].lines
      if (kind === 'reverse') list.reverse()
      if (kind === 'drop') list.pop()
      if (kind === 'duplicate') list[1] = structuredClone(list[0])

      assert.equal(
        restoreObservationSheetDraft(JSON.stringify(mutated)),
        null,
        `${target} ${kind} must refuse incompatible collected-week demand`,
      )
    }
  }
})

test('M3 exact canonical sheet remains a collection template after safe draft recovery', () => {
  const blank = buildObservationSheet()
  const recovered = restoreObservationSheetDraft(JSON.stringify(blank))
  assert.ok(recovered)
  assert.deepEqual(recovered.requirements, blank.requirements)
  assert.deepEqual(recovered.baseline.lines, blank.baseline.lines)
  assert.deepEqual(recovered.candidate.lines, blank.candidate.lines)
  assert.equal(recovered.evidenceStatus, 'collection-template-not-evidence')
  assert.notStrictEqual(recovered.requirements[0], blank.requirements[0])
  assert.notStrictEqual(recovered.baseline.lines[0], blank.baseline.lines[0])
  assert.notStrictEqual(recovered.candidate.lines[0], blank.candidate.lines[0])
})
