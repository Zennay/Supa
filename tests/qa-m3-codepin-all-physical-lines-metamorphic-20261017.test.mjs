import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'
import { auditPrivateM3FieldRunCodePin } from '../scripts/qa-m3-field-run-code-pin-20261017.mjs'

// M3 issue #205 quality-validation only. This deterministic, independent
// metamorphic matrix proves that copying the correct current-main SHA does
// NOT let mismatched 11x2 physical evidence or financial report pass.
// Every product/price/pack is fictional. The actual source converter still
// does not persist this SHA; simulate the expected future owner contract.
const SHA = 'a'.repeat(40)
const REJECTED = /^M3 private field-run code pin refused$/
const SIDES = ['baseline', 'candidate']
const CONTEXTS = ['in-store', 'online-order']
const COUNT = 11

function fixture(context, cents) {
  const sheet = buildFictionalPricedSheet(cents)
  sheet.study.priceContext = context
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const assessment = buildObservedWeekReport(study)
  sheet.study.fieldRunCommitSha = SHA
  study.fieldRunCommitSha = SHA
  assessment.fieldRunCommitSha = SHA
  return { sheet, study, assessment }
}

function proof(f) {
  return auditPrivateM3FieldRunCodePin(
    f.sheet, f.study, f.assessment, SHA)
}

function refuses(f, context) {
  assert.throws(() => proof(f), error => {
    assert.equal(error.message, 'M3 private field-run code pin refused', context)
    assert.match(error.message, REJECTED)
    assert.doesNotMatch(error.message, /[0-9a-f]{40}|fictional|DekaMarkt|PLUS/u)
    return true
  }, context)
}

const sourceMutations = {
  'price of exactly one product': product => { product.priceCents += 1 },
  'physical product identity': product => { product.productId += '-changed' },
  'physical product label': product => { product.productName += ' changed' },
  'pack quantity': product => { product.packAmount *= 2 },
  'multipack count': product => { product.packCount = 2 },
  'availability': product => { product.available = false },
}
const studyMutations = {
  'line cents': line => { line.lineTotalCents += 1 },
  'per pack cents': line => { line.pricePerPackCents += 1 },
  'matched product id': line => { line.productId += '-replaced' },
  'number of physical packages': line => { line.packs += 1 },
}
const reportMutations = {
  'baseline cents': r => { r.baselineTotalCents += 1 },
  'candidate cents': r => { r.candidateTotalCents += 1 },
  'difference cents': r => { r.deltaCents += 1 },
  'savings cents': r => { r.savingsCents += 1 },
  'claimability': r => { r.claimable = !r.claimable },
  'baseline evidence id': r => { r.baseline.evidenceId += '-old' },
  'candidate evidence id': r => { r.candidate.evidenceId += '-old' },
  'baseline line count': r => { r.baseline.matchedLineCount += 1 },
  'candidate unresolved count': r => { r.candidate.unresolvedLineCount += 1 },
}

test('all 11x2 original physical store positions × 6 edits × 2 contexts reject copied Git SHA', () => {
  let checked = 0
  for (const context of CONTEXTS) {
    for (const side of SIDES) {
      for (let i = 0; i < COUNT; i++) {
        for (const [label, mutate] of Object.entries(sourceMutations)) {
          const f = fixture(context, 90)
          const product = f.sheet[side].lines[i].observedProduct
          mutate(product)
          refuses(f, context + ':' + side + ':' + i + ':' + label)
          checked++
        }
      }
    }
  }
  assert.equal(checked, 264)
})

test('all 11x2 converted product positions × 4 edits × 2 contexts reject copied Git SHA', () => {
  let checked = 0
  for (const context of CONTEXTS) {
    for (const side of SIDES) {
      for (let i = 0; i < COUNT; i++) {
        for (const [label, mutate] of Object.entries(studyMutations)) {
          const f = fixture(context, 110)
          const line = f.study[side].basket.lines[i]
          mutate(line)
          refuses(f, context + ':' + side + ':' + i + ':' + label)
          checked++
        }
      }
    }
  }
  assert.equal(checked, 176)
})

test('nine independent summary mutations cannot launder source and report with same SHA', () => {
  let checked = 0
  for (const context of CONTEXTS) {
    for (const [label, mutate] of Object.entries(reportMutations)) {
      const f = fixture(context, 90)
      mutate(f.assessment)
      refuses(f, context + ':' + label)
      checked++
    }
  }
  assert.equal(checked, 18)
})

test('nonprojected private notes stay nonrelease, canonical physical evidence remains bound', () => {
  let controls = 0
  for (const context of CONTEXTS) for (const cents of [0, 90, 100, 110]) {
    const f = fixture(context, cents)
    f.sheet.baseline.lines[0].observedProduct.note = 'fictional-human-note'
    const before = JSON.stringify(f)
    const verdict = proof(f)
    assert.deepEqual(Object.keys(verdict).sort(), [
      'canonicalPhysicalProjectionBound', 'codePinMatched', 'm3ExitProven',
      'privateOnly', 'publicSavingsClaimEligible', 'verifiedRetailerObservations',
    ].sort())
    assert.equal(verdict.codePinMatched, true)
    assert.equal(verdict.canonicalPhysicalProjectionBound, true)
    assert.equal(verdict.publicSavingsClaimEligible, false)
    assert.equal(verdict.m3ExitProven, false)
    assert.ok(Object.isFrozen(verdict))
    assert.equal(JSON.stringify(f), before)
    assert.doesNotMatch(JSON.stringify(verdict), /fictional|note|[0-9a-f]{40}|PLUS|DekaMarkt/iu)
    controls++
  }
  assert.equal(controls, 8)
})
