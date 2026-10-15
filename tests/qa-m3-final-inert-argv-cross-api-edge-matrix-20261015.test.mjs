import assert from 'node:assert/strict'
import test from 'node:test'

import { selectedFixtureWeek } from '../scripts/retailer-reviewed-custom-week.mjs'
import {
  m3StudyWeekAlignment, main as fieldPreflightMain,
} from '../scripts/m3-field-plan-alignment.mjs'
import { m2DefaultActiveDays, m2InitialPlan } from '../src/data/m2Fixture.ts'

// Independent QA on final owner #3032, AFTER the original eleven peer
// RED->GREEN inputs were incorporated unchanged. Exercise the shared parser
// from both exported entrypoints, with adversarial non-index traps and type
// coercion that the eleven original peer cases did not cover.
// Existing fictional fixture only; no retailer traffic, observations or prices.
const fixedPlan = structuredClone(m2InitialPlan)
const dayCsv = m2DefaultActiveDays.join(',')
const defaultArgs = ['--days', dayCsv]
const canonicalPlan = m2InitialPlan
  .filter(meal => m2DefaultActiveDays.includes(meal.day))
  .map(meal => meal.day + ':' + meal.recipeId).join(',')

function originalUnchanged() {
  assert.deepEqual(m2InitialPlan, fixedPlan,
    'private field-preflight cannot edit canonical frozen research fixtures')
}

function checkMatch(argv, label) {
  const result = m3StudyWeekAlignment(argv)
  assert.equal(result.fixedStudyWeekMatches, true, label)
  assert.equal(result.matchesFixedWorksheetDemand, true, label)
  assert.deepEqual(result.selectedDays, m2DefaultActiveDays, label)
  assert.deepEqual(result.missingDays, [], label)
  assert.deepEqual(result.changedRecipes, [], label)
  assert.deepEqual(result.storesToObserve, ['PLUS', 'DekaMarkt'], label)
  assert.equal(result.physicalStudyIngredientsPerStore, 11, label)
  assert.equal(result.retailerReusePermissionVerified, false, label)
  assert.equal(result.fieldObservationEvidenceCollected, false, label)
  assert.equal(result.publicSavingsClaimEligible, false, label)
  assert.equal(result.liveRetailerRequests, 0, label)
  return result
}
function checkDenied(argv, check, label) {
  const privateMarker = 'QA_PRIVATE_ONLY_MARKER_20261015'
  for (const api of [
    value => selectedFixtureWeek(value),
    value => m3StudyWeekAlignment(value),
    value => {
      const writes = []
      try {
        fieldPreflightMain(value, message => writes.push(message))
      } finally {
        assert.deepEqual(writes, [], label + ' must emit no success-shaped JSON')
      }
    },
  ]) {
    assert.throws(() => api(argv), error =>
      error instanceof Error && !String(error.message).includes(privateMarker),
    label)
  }
  check()
}

test('QA cross-API: inert canonical arrays with null/custom prototypes still preserve exact M3 proof', () => {
  for (const [label, proto] of [
    ['null prototype', null],
    ['custom inert prototype', Object.create(Array.prototype)],
  ]) {
    const argv = [...defaultArgs]
    Object.setPrototypeOf(argv, proto)
    assert.deepEqual(selectedFixtureWeek(argv).days, m2DefaultActiveDays, label)
    checkMatch(argv, label)
  }
  checkMatch(Object.freeze(['--plan', canonicalPlan]), 'frozen full --plan')
  originalUnchanged()
})

test('QA cross-API: irrelevant iterator and toJSON getter traps are never read on valid data arguments', () => {
  let calls = 0
  for (const property of [Symbol.iterator, 'toJSON', 'secretOperatorContext']) {
    const argv = [...defaultArgs]
    Object.defineProperty(argv, property, {
      configurable: true,
      get() {
        calls++
        throw Error('QA_PRIVATE_ONLY_MARKER_20261015')
      },
    })
    assert.deepEqual(selectedFixtureWeek(argv).days, m2DefaultActiveDays)
    checkMatch(argv, String(property))
    assert.equal(calls, 0, 'irrelevant or inherited getters must never execute')
  }
  originalUnchanged()
})

test('QA cross-API: 12 invalid coercible flag/value primitives and objects refuse without invoking hooks', () => {
  let calls = 0
  const coercible = Object.create(null)
  Object.defineProperty(coercible, Symbol.toPrimitive, {
    value() { calls++; throw Error('QA_PRIVATE_ONLY_MARKER_20261015') },
  })
  Object.defineProperty(coercible, 'toString', {
    get() { calls++; throw Error('QA_PRIVATE_ONLY_MARKER_20261015') },
  })
  const badTokens = [coercible, null, undefined, true, false, 0]
  let scenarios = 0
  for (const index of [0, 1]) for (const token of badTokens) {
    const argv = [...defaultArgs]
    argv[index] = token
    checkDenied(argv, () => assert.equal(calls, 0), 'coercion input ' + index + '/' + scenarios)
    scenarios++
  }
  assert.equal(scenarios, 12)
  originalUnchanged()
})

test('QA cross-API: four revoked/proxy array traps fail without executing GET or descriptor traps', () => {
  let getCalls = 0
  let descriptorCalls = 0
  const proxyOptions = [
    new Proxy([...defaultArgs], {
      get() { getCalls++; throw Error('QA_PRIVATE_ONLY_MARKER_20261015') },
    }),
    new Proxy([...defaultArgs], {
      getOwnPropertyDescriptor() {
        descriptorCalls++
        throw Error('QA_PRIVATE_ONLY_MARKER_20261015')
      },
    }),
  ]
  const revoked = Proxy.revocable([...defaultArgs], {})
  revoked.revoke()
  const revokedWithTrap = Proxy.revocable([...defaultArgs], {
    getOwnPropertyDescriptor() { descriptorCalls++; return undefined },
  })
  revokedWithTrap.revoke()
  for (const [index, value] of [...proxyOptions, revoked.proxy, revokedWithTrap.proxy].entries()) {
    checkDenied(value, () => {
      assert.equal(getCalls, 0)
      assert.equal(descriptorCalls, 0)
    }, 'Proxy/revoked ' + index)
  }
  originalUnchanged()
})

test('QA cross-API: validation denies index getters while ignoring unrelated hostile inherited traps', () => {
  let accessed = 0
  for (const position of ['0', '1']) {
    const argv = [...defaultArgs]
    const proto = Object.create(Array.prototype)
    Object.defineProperty(proto, 'unrelatedPrivateProperty', {
      get() { accessed++; throw Error('QA_PRIVATE_ONLY_MARKER_20261015') },
    })
    Object.setPrototypeOf(argv, proto)
    Object.defineProperty(argv, position, {
      configurable: true,
      get() { accessed++; throw Error('QA_PRIVATE_ONLY_MARKER_20261015') },
    })
    checkDenied(argv, () => assert.equal(accessed, 0), 'accessor slot ' + position)
  }
  originalUnchanged()
})

test('QA cross-API: safe main writer emits one canonical JSON only for inert valid args', () => {
  const writes = []
  const summary = checkMatch([...defaultArgs], 'canonical')
  assert.equal(fieldPreflightMain(Object.freeze([...defaultArgs]), text => writes.push(text)), 0)
  assert.equal(writes.length, 1)
  assert.deepEqual(JSON.parse(writes[0]), summary)
  assert.equal((writes[0].match(/\n/g) ?? []).length, 1)
  assert.doesNotMatch(writes[0], /QA_PRIVATE_ONLY_MARKER|pricePerPackCents|savingsCents|sourceUrl/)
  originalUnchanged()
})
