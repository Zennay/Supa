import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { comparisonNextStep } from '../src/features/basket/comparisonNextStep.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

const left = { id: 'qa-privacy-store-a', name: 'Synthetic store A' }
const right = { id: 'qa-privacy-store-b', name: 'Synthetic store B' }

function makeBasket(store) {
  const products = [
    ...m2Products.map((p) => ({ ...p, id: `${store.id}:${p.id}`, storeId: store.id })),
    {
      id: `${store.id}:garam`,
      name: 'Garam masala 50 g',
      storeId: store.id,
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139,
    },
  ]
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products,
  })
}

function expectNoSensitiveCopy(guidance, secret) {
  const visibleCopy = [guidance.title, guidance.explanation, guidance.action].join(' ')
  assert.ok(guidance.code)
  assert.doesNotMatch(visibleCopy, new RegExp(secret))
  assert.doesNotMatch(visibleCopy, /participantKey|provenanceNote|evidenceId|studyId|stack trace/i)
  assert.match(guidance.action, /\S/)
}

test('private metadata and diagnosis strings are never interpolated into user-facing next actions', () => {
  const baseline = makeBasket(left)
  const candidate = makeBasket(right)
  const reference = compareFullBaskets({ baseline, candidate })
  assert.equal(reference.claimable, true)

  for (let index = 0; index < 48; index += 1) {
    const secret = `PRIVATE_MARKER_${String(index).padStart(3, '0')}_DO_NOT_SHOW`
    const input = {
      baseline: {
        ...baseline,
        store: { ...baseline.store, name: `Synthetic ${secret}` },
      },
      candidate: {
        ...candidate,
        lines: candidate.lines.map((line, pos) =>
          pos === 0
            ? { ...line, productName: `Untrusted ${secret}`, reasons: [secret] }
            : line,
        ),
      },
      comparison: {
        ...reference,
        claimable: false,
        outcome: 'unknown',
        deltaCents: null,
        savingsCents: null,
        reasons: [`internal diagnosis ${secret}`],
        lineDeltas: [],
      },
    }
    const snapshot = JSON.stringify(input)
    const guidance = comparisonNextStep(input)
    assert.equal(guidance.canShowDifference, false)
    expectNoSensitiveCopy(guidance, secret)
    assert.equal(JSON.stringify(input), snapshot)
  }
})

test('privacy remains intact even if store metadata includes quote and HTML-like payloads', () => {
  const marker = 'SENSITIVE_PERSON_XYZ'
  const baseline = makeBasket(left)
  const candidate = makeBasket(right)
  const comparison = compareFullBaskets({ baseline, candidate })
  const result = comparisonNextStep({
    baseline: { ...baseline, store: { ...left, name: `<script>${marker}</script>` } },
    candidate: { ...candidate, store: { ...right, name: `"${marker}"` } },
    comparison,
  })
  expectNoSensitiveCopy(result, marker)
  assert.equal(result.code, 'comparison-ready')
  assert.equal(result.canShowDifference, true)
})
