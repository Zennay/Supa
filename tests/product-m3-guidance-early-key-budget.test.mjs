import assert from 'node:assert/strict'
import test from 'node:test'

import { comparisonNextStep } from '../src/features/basket/comparisonNextStep.ts'

// This is a synthetic input boundary test. It does not request retailer data,
// create observations, or demonstrate genuine prices or M3 field evidence.
function expectNoMoney(input) {
  let answer
  assert.doesNotThrow(() => { answer = comparisonNextStep(input) })
  assert.equal(answer.code, 'review-data')
  assert.equal(answer.canShowDifference, false)
  assert.match(answer.explanation, /onvolledig|niet onderling/)
  assert.doesNotMatch(JSON.stringify(answer), /synthetic-private-marker/)
}

function overLimitProxy() {
  const keys = Array.from({ length: 8193 }, (_, index) => `synthetic-${index}`)
  let inspected = 0
  const record = new Proxy({}, {
    ownKeys() { return keys },
    getOwnPropertyDescriptor() {
      inspected += 1
      throw Error('synthetic-private-marker')
    },
  })
  return { record, count: () => inspected }
}

test('M3 guidance rejects >8192 top-level keys before ANY source descriptor trap executes', () => {
  const { record, count } = overLimitProxy()
  expectNoMoney(record)
  assert.equal(count(), 0, 'reject large records before descriptor reflection')
})

test('same physical key budget applies to deeply reached store basket records', () => {
  for (const field of ['baseline', 'candidate', 'comparison']) {
    const { record, count } = overLimitProxy()
    expectNoMoney({
      baseline: {}, candidate: {}, comparison: {}, [field]: record,
    })
    assert.equal(count(), 0, `no descriptor iteration for overlarge ${field}`)
  }
})

test('small accessor-bearing source descriptor never invokes its getter', () => {
  let executed = 0
  const input = Object.defineProperty({ baseline: {}, candidate: {} }, 'comparison', {
    enumerable: true,
    get() { executed++; throw Error('synthetic-private-marker') },
  })
  expectNoMoney(input)
  assert.equal(executed, 0)
})

test('a revocable Proxy with a throwing key enumeration cannot escape the public advice boundary', () => {
  const record = new Proxy({}, {
    ownKeys() { throw Error('synthetic-private-marker') },
  })
  expectNoMoney(record)
  const revoked = Proxy.revocable({}, {})
  revoked.revoke()
  expectNoMoney(revoked.proxy)
})

test('plain oversized baskets and arrays also abstain instead of rendering a money claim', () => {
  const root = Object.fromEntries(
    Array.from({ length: 8193 }, (_, index) => [`synthetic-${index}`, index]),
  )
  expectNoMoney(root)
  expectNoMoney({
    baseline: Array.from({ length: 2049 }, () => ({})),
    candidate: {}, comparison: {},
  })
})
