import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'
import { auditPrivateM3FieldRunCodePin } from '../scripts/qa-m3-field-run-code-pin-20261017.mjs'

// QA-only synthetic M3 issue #205. One physically missing 11x2 pack cannot
// be inferred as zero price or a public win merely because all three files
// happen to carry an identical Git SHA. No real retailer HTTP or evidence.
const SHA = 'a'.repeat(40)
const contexts = ['in-store', 'online-order']
const sides = ['baseline', 'candidate']

function fixture(context, price, absentPositions) {
  const sheet = buildFictionalPricedSheet(price)
  sheet.study.priceContext = context
  for (const [side, index] of absentPositions) {
    sheet[side].lines[index].observedProduct.available = false
    // Old money remains in a draft but is NEVER an available/known quote.
    sheet[side].lines[index].observedProduct.priceCents = 777777
  }
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const report = buildObservedWeekReport(study)
  sheet.study.fieldRunCommitSha = SHA
  study.fieldRunCommitSha = SHA
  report.fieldRunCommitSha = SHA
  return { sheet, study, report }
}

function proof(f) {
  return auditPrivateM3FieldRunCodePin(f.sheet, f.study, f.report, SHA)
}

function assertNotRelease(f, context) {
  assert.equal(f.report.publicSavingsClaimEligible, false, context)
  assert.equal(f.report.claimable, false, context)
  assert.equal(f.report.outcome, 'unknown', context)
  assert.equal(f.report.deltaCents, null, context)
  assert.equal(f.report.savingsCents, null, context)
  const result = proof(f)
  assert.equal(result.codePinMatched, true, context)
  assert.equal(result.canonicalPhysicalProjectionBound, true, context)
  assert.equal(result.verifiedRetailerObservations, false, context)
  assert.equal(result.m3ExitProven, false, context)
  assert.equal(result.publicSavingsClaimEligible, false, context)
  assert.doesNotMatch(JSON.stringify(result),
    /777777|PLUS|DekaMarkt|[0-9a-f]{40}|participant/iu, context)
}

test('each of 11x2 individual missing pack positions × two contexts × 3 price directions stays unknown but retains private SHA binding', () => {
  let acceptedPrivateUnknown = 0
  let refusedSilentCompletion = 0
  for (const context of contexts) for (const price of [90, 100, 110]) {
    for (const side of sides) for (let index = 0; index < 11; index++) {
      const label = context + ':' + side + ':' + index + ':' + price
      const f = fixture(context, price, [[side, index]])
      assert.equal(f.study[side].basket.unresolvedLineCount, 1, label)
      assert.equal(f.study[side].basket.matchedLineCount, 10, label)
      assertNotRelease(f, label)
      acceptedPrivateUnknown++

      // Later tampering with recorded unavailable -> available must not
      // rescue an already-derived "unknown" report under the copied pin.
      f.sheet[side].lines[index].observedProduct.available = true
      assert.throws(() => proof(f), /^Error: M3 private field-run code pin refused$/, label)
      refusedSilentCompletion++
    }
  }
  assert.equal(acceptedPrivateUnknown, 132)
  assert.equal(refusedSilentCompletion, 132)
})

test('completely unavailable physical stores still yield private unknown outcome, never a public win', () => {
  let cases = 0
  for (const context of contexts) {
    for (const missingSide of ['baseline', 'candidate', 'both']) {
      const missing = []
      for (const side of sides) {
        if (missingSide !== 'both' && missingSide !== side) continue
        for (let index = 0; index < 11; index++) missing.push([side, index])
      }
      const f = fixture(context, 90, missing)
      assertNotRelease(f, context + ':' + missingSide)
      assert.equal(f.study.baseline.basket.unresolvedLineCount,
        missingSide === 'baseline' || missingSide === 'both' ? 11 : 0)
      assert.equal(f.study.candidate.basket.unresolvedLineCount,
        missingSide === 'candidate' || missingSide === 'both' ? 11 : 0)
      cases++
    }
  }
  assert.equal(cases, 6)
})

test('old price behind explicitly absent pack is not projected into valid M3 money even when byte value changes', () => {
  let cases = 0
  for (const context of contexts) for (const side of sides) {
    const f = fixture(context, 90, [[side, 4]])
    const sourcePrice = f.sheet[side].lines[4].observedProduct
    for (const untrustedOldPrice of [0, 999, 777777, null]) {
      sourcePrice.priceCents = untrustedOldPrice
      assertNotRelease(f, side + ':' + context + ':' + String(untrustedOldPrice))
      cases++
    }
  }
  assert.equal(cases, 16)
})
