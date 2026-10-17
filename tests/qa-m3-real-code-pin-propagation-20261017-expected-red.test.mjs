import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

// OWNER ACCEPTANCE / EXPECTED RED for existing #205, not a shipping feature.
// Current source drops fieldRunCommitSha at BOTH canonical projection borders.
// Must not accidentally mark these fixture outcomes as real retailer evidence.
// Opt-in pin is backwards-compatible with legacy fictional test sheets.
const HEAD = 'a'.repeat(40)
const legacy = () => buildFictionalPricedSheet(90)

test('legacy fictional sheet without optional field-run SHA remains nonpublic', () => {
  const sheet = legacy()
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const report = buildObservedWeekReport(study)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(Object.hasOwn(sheet.study, 'fieldRunCommitSha'), false)
})

for (const context of ['in-store', 'online-order']) {
  test('issue #205 source owner: exact main SHA survives real sheet-to-study conversion / ' + context, () => {
    const sheet = legacy()
    sheet.study.priceContext = context
    sheet.study.fieldRunCommitSha = HEAD
    const original = JSON.stringify(sheet)
    const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
    assert.equal(JSON.stringify(sheet), original)
    assert.equal(study.fieldRunCommitSha, HEAD,
      'real product converter must retain opt-in 40-digit field-run source commit')
  })
}

test('issue #205 source owner: exact pinned study SHA reaches privacy-safe assessor', () => {
  const study = buildWeeklyBasketStudyFromObservationSheet(legacy())
  study.fieldRunCommitSha = HEAD
  const report = buildObservedWeekReport(study)
  assert.equal(report.fieldRunCommitSha, HEAD,
    'assessment must retain exact pinned code identity without revealing participant')
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal('participantKey' in report, false)
})

for (const [name, invalid] of [
  ['short', 'a'.repeat(39)], ['long', 'a'.repeat(41)],
  ['capital letters', 'A'.repeat(40)], ['whitespace', ' ' + HEAD],
  ['hex prefix', '0x' + HEAD], ['newline', HEAD + '\n'],
  ['non hex', 'g'.repeat(40)], ['integer', 5],
  ['array', [HEAD]], ['null', null],
]) {
  test('issue #205 source owner: opt-in field-run SHA must reject ' + name, () => {
    const sheet = legacy()
    sheet.study.fieldRunCommitSha = invalid
    assert.throws(
      () => buildWeeklyBasketStudyFromObservationSheet(sheet),
      'genuine opt-in provenance with invalid Git SHA cannot silently create a claimable study',
    )
  })
}
