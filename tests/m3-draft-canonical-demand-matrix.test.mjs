import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'

// A saved M3 draft is editable support, never observed or approved retailer evidence.
const serialize = (sheet) => JSON.stringify(sheet)

function tamperedCopy(sheet, mutate) {
  const copy = structuredClone(sheet)
  mutate(copy)
  return copy
}

test('M3 draft roundtrip preserves all 11 fixed-demand identities for both retailers', () => {
  const original = buildObservationSheet()
  assert.equal(original.requirements.length, 11)
  const restored = restoreObservationSheetDraft(serialize(original))

  assert.ok(restored)
  assert.deepEqual(restored.requirements, original.requirements)
  for (const side of ['baseline', 'candidate']) {
    assert.deepEqual(
      restored[side].lines.map((line) => ({
        id: line.ingredientId,
        label: line.ingredientLabel,
        ...line.requirement,
      })),
      original.requirements.map(({ id, label, amount, unit }) => ({
        id,
        label,
        amount,
        unit,
      })),
      `${side} must use exactly the same canonical quantities and identities`,
    )
  }
  assert.equal(restored.evidenceStatus, 'collection-template-not-evidence')
})

test('M3 draft recovery fails closed on every one-line identity/demand mutation on either side', () => {
  const original = buildObservationSheet()
  let checked = 0

  for (const side of ['baseline', 'candidate']) {
    for (let index = 0; index < original.requirements.length; index += 1) {
      const scenarios = [
        {
          name: 'ingredientId',
          mutate: (line) => { line.ingredientId = `${line.ingredientId}-other` },
        },
        {
          name: 'ingredientLabel',
          mutate: (line) => { line.ingredientLabel = `${line.ingredientLabel} changed` },
        },
        {
          name: 'requirement amount',
          mutate: (line) => { line.requirement.amount += 1 },
        },
        {
          name: 'requirement unit',
          mutate: (line) => { line.requirement.unit = 'invented-unit' },
        },
      ]

      for (const scenario of scenarios) {
        const mutated = tamperedCopy(original, (copy) => {
          scenario.mutate(copy[side].lines[index])
        })
        const before = serialize(mutated)

        assert.equal(
          restoreObservationSheetDraft(before),
          null,
          `${side} line ${index}: ${scenario.name} drift must reject the whole draft`,
        )
        assert.equal(
          serialize(mutated),
          before,
          'rejection must not rewrite unreviewed operator evidence',
        )
        checked += 1
      }
    }
  }

  assert.equal(checked, 88)
})

test('M3 draft recovery rejects every frozen requirement catalog drift, not just first-line drift', () => {
  const original = buildObservationSheet()
  let checked = 0

  for (let index = 0; index < original.requirements.length; index += 1) {
    const changes = [
      (item) => { item.id = `${item.id}-other` },
      (item) => { item.label = `${item.label} altered` },
      (item) => { item.query = `${item.query}-other` },
      (item) => { item.amount *= 2 },
      (item) => { item.unit = 'unknown' },
    ]

    for (const mutate of changes) {
      const corrupted = tamperedCopy(original, (sheet) => {
        mutate(sheet.requirements[index])
      })
      assert.equal(
        restoreObservationSheetDraft(serialize(corrupted)),
        null,
        `canonical requirement ${index} must reject mutation`,
      )
      checked += 1
    }
  }

  assert.equal(checked, 55)
})

test('M3 draft recovery rejects line removal, addition and reordering independently on either side', () => {
  const original = buildObservationSheet()

  for (const side of ['baseline', 'candidate']) {
    const deleted = tamperedCopy(original, (sheet) => {
      sheet[side].lines.splice(0, 1)
    })
    const appended = tamperedCopy(original, (sheet) => {
      sheet[side].lines.push(structuredClone(sheet[side].lines[0]))
    })
    const swapped = tamperedCopy(original, (sheet) => {
      const lines = sheet[side].lines
      ;[lines[0], lines[1]] = [lines[1], lines[0]]
    })

    assert.equal(restoreObservationSheetDraft(serialize(deleted)), null)
    assert.equal(restoreObservationSheetDraft(serialize(appended)), null)
    assert.equal(restoreObservationSheetDraft(serialize(swapped)), null)
  }
})

test('M3 draft recovery never interprets forged schema or evidence status as reviewed proof', () => {
  const original = buildObservationSheet()
  const changes = [
    (sheet) => { sheet.schemaVersion = 2 },
    (sheet) => { sheet.sheetType = 'm3-reviewed-study' },
    (sheet) => { sheet.evidenceStatus = 'observed-and-verified' },
    (sheet) => { sheet.plannerFixture = 'replaced-week' },
    (sheet) => { sheet.selectedMealCount += 1 },
    (sheet) => { sheet.study.maxObservationWindowHours = 1000 },
  ]

  for (const mutate of changes.slice(0, 5)) {
    const forged = tamperedCopy(original, mutate)
    assert.equal(restoreObservationSheetDraft(serialize(forged)), null)
  }

  // The editable max-window value is deliberately not trusted on import.
  const tampered = tamperedCopy(original, changes[5])
  const restored = restoreObservationSheetDraft(serialize(tampered))
  assert.ok(restored)
  assert.equal(restored.study.maxObservationWindowHours, 24)
  assert.equal(restored.evidenceStatus, 'collection-template-not-evidence')
})
