import assert from 'node:assert/strict'
import test from 'node:test'

import { comparisonNextStep } from '../src/features/basket/comparisonNextStep.ts'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

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

test('M3 independent QA diagnostic: root throwing Proxy trap cannot escape consumer guidance', () => {
  const input = new Proxy({}, {
    get() {
      throw Error('qa-private-synthetic-trap')
    },
  })
  // Browser code cannot reliably detect arbitrary Proxies without risking
  // traps. It must nevertheless prevent exceptions reaching the caller.
  safeAdvice(input)
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

test('M3 independent QA diagnostic: valid nonempty controlled comparison still succeeds', () => {
  const oneStore = (id) => {
    const store = { id, name: 'Fictieve QA winkel' }
    const products = [
      ...m2Products.map((product) => ({
        ...product, id: `${id}-${product.id}`, storeId: id,
      })),
      {
        id: `${id}-garam`, storeId: id, name: 'Garam masala 50 g',
        packAmount: 50, packUnit: 'g', priceCents: 139, available: true,
      },
    ]
    return buildOneStoreBasket({
      store, plan: m2InitialPlan, recipes: m2Recipes,
      activeDays: m2DefaultActiveDays, products,
    })
  }
  const baseline = oneStore('qa-inmemory-baseline')
  const candidate = oneStore('qa-inmemory-candidate')
  const comparison = compareFullBaskets({ baseline, candidate })
  assert.equal(comparison.claimable, true)
  const before = JSON.stringify({ baseline, candidate, comparison })
  const advice = comparisonNextStep({ baseline, candidate, comparison })
  assert.equal(advice.code, 'comparison-ready')
  assert.equal(advice.canShowDifference, true)
  assert.match(advice.explanation, /geen actuele winkelprijzen/)
  assert.equal(JSON.stringify({ baseline, candidate, comparison }), before)
})
