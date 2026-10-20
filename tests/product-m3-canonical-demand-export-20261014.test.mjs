import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import {
  observationSheetReadiness, restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

const now = Date.parse('2026-10-14T12:00:00Z')

// All requirements and prices are the deterministic M2/M3 fictional fixtures,
// never a human retailer observation or a public money proof.
const mutations = [
  ['evidence status', s => { s.evidenceStatus = 'actual-field-evidence' }],
  ['sheet type', s => { s.sheetType = 'unknown' }],
  ['selected meal count', s => { s.selectedMealCount += 1 }],
  ['demand amount', s => { s.requirements[0].amount += 1 }],
  ['demand order', s => { s.requirements.reverse() }],
  ['extra canonical requirement', s => { s.requirements[0].sourcePrice = 100 }],
  ['reordered canonical fields', s => {
    const { id, label, query, amount, unit } = s.requirements[0]
    s.requirements[0] = { unit, amount, query, label, id }
  }],
  ['baseline physical demand', s => { s.baseline.lines[0].requirement.amount += 1 }],
  ['candidate physical demand extra', s => { s.candidate.lines[0].requirement.extraPack = 5 }],
  ['candidate line omitted', s => { s.candidate.lines.pop() }],
  ['duplicate physical requirement slot', s => {
    s.candidate.lines[2] = structuredClone(s.candidate.lines[1])
  }],
  ['48-hour fake permission', s => {
    s.study.maxObservationWindowHours = 48
    s.candidate.observedAt = '2026-10-02T11:00:00Z'
  }],
]

test('M3 operator collector refuses altered canonical 11+11 demand and falsified 24h preflight', () => {
  for (const [name, mutate] of mutations) {
    const sheet = buildFictionalPricedSheet()
    mutate(sheet)
    const original = JSON.stringify(sheet)
    const readiness = observationSheetReadiness(sheet, now)
    assert.equal(readiness.ready, false, name)
    assert.ok(readiness.issues.some(i => /vaste weekplanning|24 uur|basis- of winkelgegevens/.test(i)),
      name + ': operator needs a comprehensible fixed-demand/window warning')
    assert.throws(() => buildWeeklyBasketStudyFromObservationSheet(sheet),
      undefined, name + ': authoritative converter also rejects corrupted collection')
    assert.equal(JSON.stringify(sheet), original, 'never repair evidence silently')
  }
})

test('M3 local JSON restore refuses tampered immutable demand and window instead of normalizing it', () => {
  for (const [name, mutate] of mutations) {
    const sheet = buildFictionalPricedSheet()
    mutate(sheet)
    const serialized = JSON.stringify(sheet)
    assert.equal(restoreObservationSheetDraft(serialized), null, name)
    assert.equal(JSON.stringify(sheet), serialized)
  }
})

test('M3 canonical 11+11 price observation remains complete and privately comparable', () => {
  const sheet = buildFictionalPricedSheet(90)
  const original = JSON.stringify(sheet)
  const result = observationSheetReadiness(sheet, now)
  assert.equal(result.ready, true, JSON.stringify(result.issues))
  const report = buildObservedWeekReport(buildWeeklyBasketStudyFromObservationSheet(sheet))
  assert.equal(report.claimable, true)
  assert.equal(report.outcome, 'better')
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(Object.hasOwn(report, 'participantKey'), false)
  assert.equal(JSON.stringify(sheet), original)
})

test('M3 malformed nested rows cannot crash preflight into a false ready outcome', () => {
  for (const [name, mutate] of [
    ['missing study', s => { s.study = null }],
    ['missing baseline store', s => { s.baseline.store = null }],
    ['missing candidate line', s => { s.candidate.lines[0] = null }],
    ['missing observed product', s => { s.baseline.lines[0].observedProduct = null }],
  ]) {
    const sheet = buildFictionalPricedSheet()
    mutate(sheet)
    const result = observationSheetReadiness(sheet, now)
    assert.equal(result.ready, false, name)
    assert.ok(result.issues.length > 0)
  }
})
