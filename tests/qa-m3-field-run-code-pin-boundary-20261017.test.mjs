import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'
import { auditPrivateM3FieldRunCodePin } from '../scripts/qa-m3-field-run-code-pin-20261017.mjs'

// All values fictional. Three explicit injected pins simulate post-#205
// records; the current M3 converter DOES NOT persist this pin. This test
// validates the QA gate only, and does not claim #205 is repaired.
const SHA = 'a'.repeat(40)
const ALTERNATE = 'b'.repeat(40)
const CANARY = 'fictional-private-person-20261017'
const failure = /^(?:Error: )?M3 private field-run code pin refused$/
const audit = f => auditPrivateM3FieldRunCodePin(
  f.sheet, f.study, f.assessment, f.expectedMainSha)

function fixture(candidatePrice = 90, context = 'in-store') {
  const sheet = buildFictionalPricedSheet(candidatePrice)
  sheet.study.priceContext = context
  sheet.study.participantKey = CANARY
  // Capture the real converter output before simulating a future correct
  // source owner implementation of optional field-run code provenance.
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const assessment = buildObservedWeekReport(study)
  sheet.study.fieldRunCommitSha = SHA
  study.fieldRunCommitSha = SHA
  assessment.fieldRunCommitSha = SHA
  return { sheet, study, assessment, expectedMainSha: SHA }
}

test('hypothetical code-pinned private M3 artifacts admit matching exact current-main SHA without leaking fields', () => {
  let cases = 0
  for (const price of [0, 90, 100, 110]) {
    for (const context of ['in-store', 'online-order']) {
      const f = fixture(price, context)
      const frozen = JSON.stringify(f)
      const result = audit(f)
      assert.equal(result.codePinMatched, true)
      assert.equal(result.canonicalPhysicalProjectionBound, true)
      assert.equal(result.publicSavingsClaimEligible, false)
      assert.equal(result.verifiedRetailerObservations, false)
      assert.equal(result.m3ExitProven, false)
      assert.ok(Object.isFrozen(result))
      assert.equal(JSON.stringify(f), frozen, 'read-only audit must not rewrite field evidence')
      assert.doesNotMatch(JSON.stringify(result), /[a-f0-9]{40}|fictional-private-person|PLUS|DekaMarkt/u)
      cases++
    }
  }
  assert.equal(cases, 8)
})

test('missing/invalid revision on any of three artifacts, or independent expected HEAD, fails closed', () => {
  let checks = 0
  for (const field of ['sheet', 'study', 'assessment', 'expected']) {
    for (const broken of [
      undefined, null, '', ' ', 'a'.repeat(39), 'a'.repeat(41),
      ALTERNATE, SHA.toUpperCase(), '0x' + SHA,
      SHA + '\n', 'git-' + SHA, 0, 42, true, {}, [SHA],
    ]) {
      const f = fixture()
      if (field === 'expected') f.expectedMainSha = broken
      else {
        const target = field === 'sheet' ? f.sheet.study : f[field]
        if (broken === undefined) delete target.fieldRunCommitSha
        else target.fieldRunCommitSha = broken
      }
      assert.throws(() => audit(f), e => {
        assert.match(String(e), failure)
        assert.doesNotMatch(String(e), /fictional-private-person|studyId|[a-f0-9]{40}/u)
        return true
      }, field + ' ' + String(broken).slice(0, 20))
      checks++
    }
  }
  assert.equal(checks, 64)
})

test('artifact identity drift refuses reused code pin without a changed full-basket claim', () => {
  let checks = 0
  for (const field of ['studyId', 'weekStart', 'priceContext']) {
    for (const location of ['sheet', 'study', 'assessment']) {
      const f = fixture()
      const target = location === 'sheet' ? f.sheet.study : f[location]
      target[field] = field === 'priceContext'
        ? 'online-order' : field === 'weekStart'
          ? '2026-09-21' : 'synthetic-other-study'
      assert.throws(() => audit(f), failure)
      checks++
    }
  }
  assert.equal(checks, 9)
})

test('accessor-backed, inherited and malformed pin facts never become acceptable financial provenance', () => {
  let cases = 0
  for (const location of ['sheet', 'study', 'assessment']) {
    const f = fixture()
    const record = location === 'sheet' ? f.sheet.study : f[location]
    let getterCalls = 0
    Object.defineProperty(record, 'fieldRunCommitSha', {
      configurable: true, enumerable: true, get() { getterCalls++; return SHA },
    })
    assert.throws(() => audit(f), failure)
    assert.equal(getterCalls, 0, 'audit must refuse accessor without reading it')
    cases++

    const inherited = fixture()
    const original = location === 'sheet' ? inherited.sheet.study : inherited[location]
    delete original.fieldRunCommitSha
    Object.setPrototypeOf(original, { fieldRunCommitSha: SHA })
    assert.throws(() => audit(inherited), failure)
    cases++
  }
  assert.equal(cases, 6)
})

test('release/claim flags, planning window and canonical M2 fixture cannot be bypassed with a copied pin', () => {
  let checks = 0
  for (const mutate of [
    f => { f.assessment.publicSavingsClaimEligible = true },
    f => { f.sheet.plannerFixture = 'other-fixture' },
    f => { f.sheet.study.maxObservationWindowHours = 48 },
    f => { f.study.priceContext = 'unknown' },
    f => { f.study.schemaVersion = 2 },
    f => { f.assessment.reportType = 'public-savings-proof' },
  ]) {
    const f = fixture()
    mutate(f)
    assert.throws(() => audit(f), failure)
    checks++
  }
  assert.equal(checks, 6)
})

test('same copied SHA and study key cannot hide mismatched physical source, study or assessment money', () => {
  let checked = 0
  for (const mutate of [
    f => { f.sheet.candidate.lines[0].observedProduct.priceCents += 1 },
    f => { f.study.candidate.basket.lines[0].pricePerPackCents += 1 },
    f => { f.assessment.candidate.totalCents += 1 },
    f => { f.assessment.deltaCents += 1 },
  ]) {
    const f = fixture()
    mutate(f)
    assert.throws(() => audit(f), failure,
      'revision metadata alone is insufficient to bind 11x2 physical data')
    checked++
  }
  assert.equal(checked, 4)
})

test('deep financial accessor in assessment must not execute during canonical proof', () => {
  const f = fixture()
  let invoked = 0
  Object.defineProperty(f.assessment.candidate, 'totalCents', {
    enumerable: true, configurable: true,
    get() { invoked++; throw new Error('FICTIONAL_DO_NOT_LEAK') },
  })
  assert.throws(() => audit(f), failure)
  assert.equal(invoked, 0)
})
