import assert from 'node:assert/strict'
import test from 'node:test'
import { m3StudyWeekAlignment, main } from '../scripts/m3-field-plan-alignment.mjs'
import { m2DefaultActiveDays, m2InitialPlan } from '../src/data/m2Fixture.ts'

// Independent current-owner QA-only rejection oracle for JavaScript callers
// of the *exported* M3 field-preflight API. This is NOT testing shell argv
// tokens: the real CLI already receives inert OS strings. A programmatic
// consumer can pass sparse arrays, prototypes, accessors or a Proxy.
// No external requests, retailer rights, observations or personal files.
const frozenPlan = structuredClone(m2InitialPlan)
const canonical = ['--days', 'Ma,Di,Wo,Do']

function safeOutcome(summary) {
  assert.equal(summary.matchesFixedWorksheetDemand, true)
  assert.equal(summary.fixedStudyWeekMatches, true)
  assert.equal(summary.retailerReusePermissionVerified, false)
  assert.equal(summary.fieldObservationEvidenceCollected, false)
  assert.equal(summary.publicSavingsClaimEligible, false)
  assert.equal(summary.liveRetailerRequests, 0)
  assert.deepEqual(summary.selectedDays, m2DefaultActiveDays)
  assert.deepEqual(summary.missingDays, [])
  assert.deepEqual(summary.changedRecipes, [])
}

function inheritedIndex(index, base = canonical) {
  const args = [...base]
  const value = args[index]
  delete args[index]
  const prototype = Object.create(Array.prototype)
  Object.defineProperty(prototype, String(index), {
    configurable: true, enumerable: true, writable: true, value,
  })
  Object.setPrototypeOf(args, prototype)
  return args
}

function ownGetter(index, base = canonical) {
  const args = [...base]
  const value = args[index]
  let calls = 0
  Object.defineProperty(args, String(index), {
    configurable: true, enumerable: true,
    get() { calls++; return value },
  })
  return { args, calls: () => calls }
}

function prototypeGetter(index, base = canonical) {
  const args = [...base]
  const value = args[index]
  delete args[index]
  const prototype = Object.create(Array.prototype)
  let calls = 0
  Object.defineProperty(prototype, String(index), {
    configurable: true, enumerable: true,
    get() { calls++; return value },
  })
  Object.setPrototypeOf(args, prototype)
  return { args, calls: () => calls }
}

function getterTrappedProxy(index) {
  let calls = 0
  const args = new Proxy([...canonical], {
    get(target, key, receiver) {
      if (key === String(index)) calls++
      return Reflect.get(target, key, receiver)
    },
  })
  return { args, calls: () => calls }
}

function expectRejectedWithoutAccessorInvocation(args, invocationCount, label) {
  assert.throws(() => m3StudyWeekAlignment(args), undefined,
    label + ' cannot validate a frozen study from dynamic/inherited argv')
  assert.equal(invocationCount(), 0, label + ' must not invoke getter')
  const emitted = []
  assert.throws(() => main(args, text => emitted.push(text)), undefined,
    label + ' main API must deny dynamic/inherited argv')
  assert.deepEqual(emitted, [], label + ' must not write a success-shaped stdout record')
  assert.equal(invocationCount(), 0, label + ' getter must not run even on repeat')
}

test('direct preflight: ordinary own data and frozen own data preserve canonical 11+11 semantics', () => {
  const direct = m3StudyWeekAlignment([...canonical])
  const frozen = m3StudyWeekAlignment(Object.freeze([...canonical]))
  safeOutcome(direct)
  assert.deepEqual(frozen, direct)
  const writes = []
  assert.equal(main([...canonical], value => writes.push(value)), 0)
  assert.equal(writes.length, 1)
  assert.deepEqual(JSON.parse(writes[0]), direct)
  assert.deepEqual(m2InitialPlan, frozenPlan)
})

test('direct preflight: inherited --days flag is never considered a literal own argv flag', () => {
  expectRejectedWithoutAccessorInvocation(inheritedIndex(0), () => 0, 'inherited flag')
})

test('direct preflight: inherited canonical day CSV is never considered own argv data', () => {
  expectRejectedWithoutAccessorInvocation(inheritedIndex(1), () => 0, 'inherited CSV')
})

test('direct preflight: inherited --plan flag cannot pass for the canonical recipe week', () => {
  const args = inheritedIndex(0, ['--plan', 'Ma:tikka,Di:teriyaki,Wo:pasta,Do:tikka'])
  expectRejectedWithoutAccessorInvocation(args, () => 0, 'inherited plan flag')
})

test('direct preflight: inherited full --plan string cannot pass for canonical recipes', () => {
  const args = inheritedIndex(1, ['--plan', 'Ma:tikka,Di:teriyaki,Wo:pasta,Do:tikka'])
  expectRejectedWithoutAccessorInvocation(args, () => 0, 'inherited plan CSV')
})

for (const index of [0, 1]) {
  test('direct preflight: accessor-backed own argv[' + index + '] is never invoked', () => {
    const { args, calls } = ownGetter(index)
    expectRejectedWithoutAccessorInvocation(args, calls, 'own getter argv[' + index + ']')
  })

  test('direct preflight: inherited getter argv[' + index + '] is never invoked', () => {
    const { args, calls } = prototypeGetter(index)
    expectRejectedWithoutAccessorInvocation(args, calls, 'prototype getter argv[' + index + ']')
  })

  test('direct preflight: Proxy value GET argv[' + index + '] is not required', () => {
    const { args, calls } = getterTrappedProxy(index)
    expectRejectedWithoutAccessorInvocation(args, calls, 'Proxy get argv[' + index + ']')
  })
}

test('direct preflight: getter returning inconsistent flags must never influence study acceptance', () => {
  const args = ['--days', canonical[1]]
  let called = 0
  Object.defineProperty(args, '0', {
    enumerable: true, configurable: true,
    get() {
      called++
      return called % 2 ? '--days' : '--plan'
    },
  })
  expectRejectedWithoutAccessorInvocation(args, () => called, 'time-varying flag')
})

test('direct preflight: valid frozen --plan remains acceptable, with no new field authority', () => {
  const args = Object.freeze(['--plan', 'Ma:tikka,Di:teriyaki,Wo:pasta,Do:tikka'])
  safeOutcome(m3StudyWeekAlignment(args))
  assert.deepEqual(m2InitialPlan, frozenPlan)
})
