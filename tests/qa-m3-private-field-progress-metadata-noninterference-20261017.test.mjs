import assert from 'node:assert/strict'
import test from 'node:test'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { buildPrivateM3FieldProgress } from '../scripts/m3-private-field-progress.mjs'

// Deliberately fictional/offline field drafts: a validated *operator status*
// remains non-public, not retailer-price evidence and never a savings claim.
const CLOCK = Date.parse('2026-10-15T12:00:00Z')
const SECRET = 'FICTIONAL_PRIVATE_CANARY_NEVER_IN_REPORT_20261017'

function filledSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'fake-2026-01',
    participantKey: 'fictional-01',
    population: 'synthetic test population',
    region: 'fictional city',
    weekStart: '2026-10-12',
    priceContext: 'in-store',
  })
  for (const [side, brand, hour] of [
    ['baseline', 'PLUS fictional', '10'],
    ['candidate', 'DekaMarkt fictional', '11'],
  ]) {
    const row = sheet[side]
    row.evidenceId = side + '-fake-evidence'
    row.observedAt = '2026-10-14T' + hour + ':00:00Z'
    row.source = 'manual-cart'
    row.provenanceNote = 'synthetic paper study'
    row.store = { id: side + '-fictional-store', name: brand }
    for (const [index, line] of row.lines.entries()) {
      line.observedProduct = {
        productId: 'madeup-sku-' + index,
        productName: 'madeup item ' + index,
        available: true,
        packAmount: 500,
        packUnit: 'g',
        packCount: 1,
        priceCents: 100 + index,
        sourceUrl: 'https://example.invalid/synthetic-' + index,
        note: 'not a retail observation',
      }
    }
  }
  return sheet
}

function report(sheet) {
  const text = JSON.stringify(sheet)
  const result = buildPrivateM3FieldProgress(text, CLOCK)
  assert.equal(JSON.stringify(sheet), text, 'private report builder must not alter input')
  assert.ok(result, 'synthetic valid-shape 11x2 sheet must be restorable')
  assert.equal(result.evidenceStatus, 'unverified-operator-draft')
  assert.equal(result.verifiedRetailerObservations, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  return result
}

test('22 complete fictional product prices never produce public or verified savings claims', () => {
  const sheet = filledSheet()
  const result = report(sheet)
  assert.equal(result.progress.completeLines, 22)
  assert.equal(result.progress.incompleteLines, 0)
  assert.equal(result.progress.availabilityRecorded, 22)
  assert.equal(result.progress.expectedLines, 22)
  assert.equal(result.baseline.expectedLines, 11)
  assert.equal(result.candidate.expectedLines, 11)
  assert.equal(result.readyForPrivateReview, true)
  assert.equal(result.nextIncomplete, null)
  const text = JSON.stringify(result)
  assert.doesNotMatch(text, /priceCents|productName|sourceUrl|participantKey|population|provenanceNote|evidenceId|store\.id|savedCents|savingsCents/)
})

test('private operator status is invariant across synthetic pseudonyms, URLs, amounts, prices and names', () => {
  const sheet = filledSheet()
  const expected = report(sheet)
  const mutations = [
    (s) => { s.study.participantKey = SECRET; s.study.studyId = 'fake-different'; s.study.population = SECRET; s.study.region = SECRET },
    (s) => { for (const side of ['baseline', 'candidate']) { s[side].evidenceId = SECRET; s[side].provenanceNote = SECRET; s[side].store.id = SECRET } },
    (s) => { s.baseline.store.name = 'PLUS '+SECRET; s.candidate.store.name = 'DekaMarkt '+SECRET },
    (s) => { for (const side of ['baseline', 'candidate']) for (const row of s[side].lines) { row.observedProduct.productId = SECRET; row.observedProduct.productName = SECRET; row.observedProduct.note = SECRET; row.observedProduct.sourceUrl = 'https://example.invalid/' + SECRET } },
    (s) => { for (const side of ['baseline', 'candidate']) for (const row of s[side].lines) { row.observedProduct.priceCents = 100_000_000; row.observedProduct.packAmount = 12.5; row.observedProduct.packUnit = 'kg'; row.observedProduct.packCount = 3 } },
  ]
  for (const [index, change] of mutations.entries()) {
    const variant = structuredClone(sheet)
    change(variant)
    const actual = report(variant)
    assert.deepEqual(actual, expected, 'private field status must ignore identifying/monetary variation ' + index)
    assert.equal(JSON.stringify(actual).includes(SECRET), false, 'private canary must not be emitted')
  }
})

test('even when one synthetic price disappears, only aggregate progress changes, never a claim', () => {
  const sheet = filledSheet()
  const ready = report(sheet)
  sheet.candidate.lines[5].observedProduct.priceCents = null
  sheet.candidate.lines[5].observedProduct.productName = SECRET
  const partial = report(sheet)
  assert.equal(partial.readyForPrivateReview, false)
  assert.equal(partial.progress.completeLines, 21)
  assert.equal(partial.progress.incompleteLines, 1)
  assert.equal(partial.progress.availabilityRecorded, 22)
  assert.equal(partial.nextIncomplete.retailer, 'DekaMarkt')
  assert.equal(partial.nextIncomplete.ingredientId, sheet.candidate.lines[5].ingredientId)
  assert.equal(JSON.stringify(partial).includes(SECRET), false)
  assert.notDeepEqual(partial.progress, ready.progress)
})
