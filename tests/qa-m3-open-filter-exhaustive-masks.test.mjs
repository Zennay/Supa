import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  nextIncompleteObservationLine,
  observationLineCollectionComplete,
} from '../src/domain/m3ObservationSheet.ts'
import { observationVisibleRows } from '../src/features/observation/observationVisibleRows.ts'

// M3 synthetic-only combinatorial QA for the actual product-core filter #2423.
// Every completion arrangement is checked (not a sampling of UI mock indices).
// No prices, real store visits, user data, browser APIs or network access.
const LENGTH = 11
const COMBINATIONS = 2 ** LENGTH
const INDICES = Array.from({ length: LENGTH }, (_, index) => index)

function assertCanonicalIdentity(observation, rows, indices, context) {
  assert.deepEqual(rows.map(row => row.lineIndex), indices, context + ': original indices')
  assert.deepEqual(rows.map(row => row.line.ingredientId),
    indices.map(index => observation.lines[index].ingredientId),
    context + ': same ingredient IDs')
  for (const row of rows) {
    assert.strictEqual(row.line, observation.lines[row.lineIndex],
      context + ': visible line is original evidence object, never a copy')
  }
}

for (const side of ['baseline', 'candidate']) {
  test('M3 independent QA: exhaust all 2,048 completed/uncompleted ' + side +
    ' row combinations without losing physical 11x2 evidence identity', () => {
    const sheet = buildObservationSheet()
    const observation = sheet[side]
    const otherSide = side === 'baseline' ? 'candidate' : 'baseline'
    const other = sheet[otherSide]
    if (side === 'candidate') {
      // With PLUS complete, navigation legitimately moves to DekaMarkt.
      for (const line of sheet.baseline.lines) line.observedProduct.available = false
    }
    const siblingBefore = JSON.stringify(other)

    for (let mask = 0; mask < COMBINATIONS; mask++) {
      for (let index = 0; index < LENGTH; index++) {
        observation.lines[index].observedProduct.available =
          (mask & (1 << index)) !== 0 ? false : null
      }
      const before = JSON.stringify(observation)
      const expectedOpen = INDICES.filter(index => !(mask & (1 << index)))
      const context = side + ' mask=' + mask

      const full = observationVisibleRows(observation, false)
      const filtered = observationVisibleRows(observation, true)

      assert.equal(full.length, LENGTH, context + ': full controls always retain 11')
      assertCanonicalIdentity(observation, full, INDICES, context + ' all rows')
      assertCanonicalIdentity(observation, filtered, expectedOpen, context + ' open only')
      assert.equal(filtered.length, LENGTH - mask.toString(2).split('1').length + 1,
        context + ': no completed row in visible filter')
      assert.equal(JSON.stringify(observation), before,
        context + ': display-only filter never mutates canonical evidence')
      assert.equal(JSON.stringify(other), siblingBefore,
        context + ': filtering never modifies independent store')
      assert.equal(sheet.evidenceStatus, 'collection-template-not-evidence')

      const expectedNext = expectedOpen.length
        ? { side, ingredientId: observation.lines[expectedOpen[0]].ingredientId }
        : side === 'baseline'
          ? { side: 'candidate', ingredientId: sheet.candidate.lines[0].ingredientId }
          : null
      assert.deepEqual(nextIncompleteObservationLine(sheet), expectedNext,
        context + ': navigation targets exact first incomplete physical row')
    }
  })
}

test('M3 independent QA: available but missing price/details stays visible until truly complete', () => {
  for (const side of ['baseline', 'candidate']) {
    const sheet = buildObservationSheet()
    const observation = sheet[side]
    const row = observation.lines[5]
    const identity = row.ingredientId

    row.observedProduct.available = true
    assert.equal(observationLineCollectionComplete(row), false)
    assert.ok(observationVisibleRows(observation, true).some(r =>
      r.line === row && r.lineIndex === 5))

    Object.assign(row.observedProduct, {
      productName: 'Synthetic grocery packet',
      packAmount: 0.5,
      packUnit: 'g',
      packCount: 2,
      priceCents: null,
    })
    assert.equal(observationLineCollectionComplete(row), false,
      'missing human price must not hide product from collection')
    assert.ok(observationVisibleRows(observation, true).some(r => r.lineIndex === 5))

    row.observedProduct.priceCents = 0
    assert.equal(observationLineCollectionComplete(row), true,
      'actual zero-cent price is a recorded value, not missing data')
    assert.equal(observationVisibleRows(observation, true).some(r => r.lineIndex === 5), false)
    assert.strictEqual(observationVisibleRows(observation, false)[5].line, row)
    assert.equal(observation.lines[5].ingredientId, identity)
    assert.equal(observation.lines.length, 11)
    assert.equal(sheet.evidenceStatus, 'collection-template-not-evidence')
  }
})

test('M3 independent QA: changing only one retailer never reindexes the other', () => {
  const sheet = buildObservationSheet()
  const PLUS = sheet.baseline
  const DEKA = sheet.candidate
  const before = JSON.stringify(DEKA)
  for (const index of [0, 2, 4, 6, 8, 10]) {
    PLUS.lines[index].observedProduct.available = false
  }
  const openPLUS = observationVisibleRows(PLUS, true)
  const openDEKA = observationVisibleRows(DEKA, true)
  assertCanonicalIdentity(PLUS, openPLUS, [1, 3, 5, 7, 9], 'PLUS sparse physical indices')
  assertCanonicalIdentity(DEKA, openDEKA, INDICES, 'DekaMarkt untouched side')
  assert.equal(JSON.stringify(DEKA), before)
  assert.equal(sheet.baseline.lines.length + sheet.candidate.lines.length, 22)
})
