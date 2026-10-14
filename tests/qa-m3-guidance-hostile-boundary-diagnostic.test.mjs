import assert from 'node:assert/strict'
import test from 'node:test'

import { comparisonNextStep } from '../src/features/basket/comparisonNextStep.ts'

// Fully synthetic malformed in-memory API inputs. No customers, retailer data,
// files, network, browser, security scanning or external services are involved.
// A UI presentation helper must abstain rather than invoking caller-supplied
// accessors, proxy traps, or rendering exception strings.

function safeAdvice(input) {
  let outcome
  assert.doesNotThrow(() => {
    outcome = comparisonNextStep(input)
  }, 'untrusted comparison input must never raise a UI-rendering exception')
  assert.equal(outcome.code, 'review-data')
  assert.equal(outcome.canShowDifference, false)
  assert.equal(typeof outcome.title, 'string')
  assert.doesNotMatch(JSON.stringify(outcome), /qa-private-synthetic-trap/)
}

test('M3 independent QA diagnostic: normal invalid input abstains, without claiming monetary differences', () => {
  for (const input of [null, undefined, {}, {
    baseline: {}, candidate: {}, comparison: {},
  }]) safeAdvice(input)
})

test('M3 independent QA diagnostic: root accessor must not execute in consumer guidance', () => {
  let executed = 0
  const input = Object.defineProperty({
    comparison: {}, candidate: {},
  }, 'baseline', {
    enumerable: true,
    get() {
      executed += 1
      throw Error('qa-private-synthetic-trap')
    },
  })
  safeAdvice(input)
  assert.equal(executed, 0, 'never call an untrusted metadata getter')
})

test('M3 independent QA diagnostic: root get Proxy trap must not execute', () => {
  let executed = 0
  const input = new Proxy({}, {
    get() {
      executed += 1
      throw Error('qa-private-synthetic-trap')
    },
  })
  safeAdvice(input)
  assert.equal(executed, 0, 'never invoke a user-supplied Proxy get trap')
})

test('M3 independent QA diagnostic: revoked Proxy root must fail closed', () => {
  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()
  safeAdvice(proxy)
})

test('M3 independent QA diagnostic: revoked nested baskets and comparison roots must fail closed', () => {
  for (const field of ['baseline', 'candidate', 'comparison']) {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    safeAdvice({
      baseline: {}, candidate: {}, comparison: {},
      [field]: proxy,
    })
  }
})

test('M3 independent QA diagnostic: getter on nested basket financial shape cannot crash presentation', () => {
  let executed = 0
  const basket = Object.defineProperty({}, 'selectedMealCount', {
    enumerable: true,
    get() {
      executed++
      throw Error('qa-private-synthetic-trap')
    },
  })
  safeAdvice({ baseline: basket, candidate: {}, comparison: {} })
  assert.equal(executed, 0)
})
