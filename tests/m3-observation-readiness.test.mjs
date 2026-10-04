import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationSheetProgress,
  observationSheetReadiness,
} from '../src/domain/m3ObservationSheet.ts'

function completeSheet() {
  const sheet = buildObservationSheet()
  sheet.study.studyId = 'm3-week-001'
  sheet.study.participantKey = 'student-001'
  sheet.study.population = 'uitwonende student'
  sheet.study.region = 'Leiden'
  sheet.study.weekStart = '2026-10-05'
  sheet.study.priceContext = 'in-store'

  const observations = [
    ['baseline', 'store-a', 'Store A', 'obs-a', '2026-10-05T10:00:00.000Z'],
    ['candidate', 'store-b', 'Store B', 'obs-b', '2026-10-05T14:00:00.000Z'],
  ]

  for (const [side, storeId, storeName, evidenceId, observedAt] of observations) {
    const observation = sheet[side]
    observation.store.id = storeId
    observation.store.name = storeName
    observation.evidenceId = evidenceId
    observation.observedAt = observedAt
    observation.provenanceNote = 'Handmatig in dezelfde weekmand gecontroleerd.'

    observation.lines.forEach((line, index) => {
      line.observedProduct.available = true
      line.observedProduct.productName = `${storeName} product ${index + 1}`
      line.observedProduct.packAmount = 500
      line.observedProduct.packUnit = 'g'
      line.observedProduct.packCount = 1
      line.observedProduct.priceCents = 100 + index
    })
  }

  return sheet
}

test('M3 readiness rejects a fresh incomplete observation sheet', () => {
  const readiness = observationSheetReadiness(buildObservationSheet())

  assert.equal(readiness.ready, false)
  assert.ok(readiness.issues.length > 20)
  assert.ok(readiness.issues.some((issue) => issue.includes('Study ID ontbreekt')))
})

test('M3 readiness accepts a structurally complete two-store observation', () => {
  const readiness = observationSheetReadiness(completeSheet())

  assert.deepEqual(readiness, {
    ready: true,
    issues: [],
  })
})

test('M3 readiness rejects a missing shared price context', () => {
  const sheet = completeSheet()
  sheet.study.priceContext = ''

  const readiness = observationSheetReadiness(sheet)

  assert.equal(readiness.ready, false)
  assert.ok(readiness.issues.some((issue) => issue.includes('Prijscontext ontbreekt')))
})

test('M3 readiness rejects the same store on both sides', () => {
  const sheet = completeSheet()
  sheet.candidate.store.id = sheet.baseline.store.id

  const readiness = observationSheetReadiness(sheet)

  assert.equal(readiness.ready, false)
  assert.ok(
    readiness.issues.some((issue) =>
      issue.includes('verschillende winkel-ID'),
    ),
  )
})

test('M3 readiness rejects observations outside the 24-hour window', () => {
  const sheet = completeSheet()
  sheet.candidate.observedAt = '2026-10-06T12:30:00.000Z'

  const readiness = observationSheetReadiness(sheet)

  assert.equal(readiness.ready, false)
  assert.ok(readiness.issues.some((issue) => issue.includes('maximaal 24 uur')))
})

test('M3 readiness rejects incomplete product details for an available line', () => {
  const sheet = completeSheet()
  sheet.baseline.lines[0].observedProduct.productName = ''
  sheet.baseline.lines[0].observedProduct.packAmount = null
  sheet.baseline.lines[0].observedProduct.packUnit = null
  sheet.baseline.lines[0].observedProduct.priceCents = null

  const readiness = observationSheetReadiness(sheet)

  assert.equal(readiness.ready, false)
  assert.ok(readiness.issues.some((issue) => issue.includes('productnaam ontbreekt')))
  assert.ok(
    readiness.issues.some((issue) =>
      issue.includes('verpakkingshoeveelheid'),
    ),
  )
  assert.ok(
    readiness.issues.some((issue) =>
      issue.includes('verpakkingseenheid'),
    ),
  )
  assert.ok(
    readiness.issues.some((issue) =>
      issue.includes('prijs per verpakking'),
    ),
  )
})


test('M3 progress only counts lines complete when required observed product details exist', () => {
  const sheet = buildObservationSheet()
  const unavailable = sheet.baseline.lines[0]
  const incompleteAvailable = sheet.baseline.lines[1]

  unavailable.observedProduct.available = false
  incompleteAvailable.observedProduct.available = true

  let progress = observationSheetProgress(sheet)
  assert.equal(progress.availabilityRecorded, 2)
  assert.equal(progress.completeLines, 1)

  incompleteAvailable.observedProduct.productName = 'Observed product'
  incompleteAvailable.observedProduct.packAmount = 500
  incompleteAvailable.observedProduct.packUnit = 'g'
  incompleteAvailable.observedProduct.packCount = 1
  incompleteAvailable.observedProduct.priceCents = 249

  progress = observationSheetProgress(sheet)
  assert.equal(progress.completeLines, 2)
})
