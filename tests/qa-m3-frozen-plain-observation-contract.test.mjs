import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  buildObservedWeekReport,
} from '../scripts/m3-assess-observed-week.mjs'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

// Positive half of the #1508 admission decision; the two adversarial
// cross-basket RED suites live on the separate experimental #1502/#1507
// branches. These synthetic plain objects do NOT prove Proxy atomicity.
const baselineStore = { id: 'plus-synthetic', name: 'PLUS synthetic filiaal' }
const candidateStore = { id: 'dekamarkt-synthetic', name: 'DekaMarkt synthetic filiaal' }

function catalog(storeId, centsOffset = 0, omitExtra = false) {
  const products = m2Products.map((item) => ({
    ...item,
    id: `${storeId}-${item.id}`,
    storeId,
    priceCents: item.priceCents + centsOffset,
  }))

  if (!omitExtra) {
    products.push({
      id: `${storeId}-garam-50`,
      storeId,
      name: 'Synthetic garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 + centsOffset,
    })
  }

  return products
}

function makeBasket(store, offset = 0, omitExtra = false) {
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: catalog(store.id, offset, omitExtra),
  })
}

function study(candidateOffset = 0, omitExtra = false) {
  return {
    schemaVersion: 1,
    studyId: 'qa-atomicity-synthetic',
    participantKey: 'qa-private-participant',
    population: 'synthetic study only',
    region: 'Leiden',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'qa-baseline-001',
      observedAt: '2026-10-02T17:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic fixture: not a real retailer observation',
      basket: makeBasket(baselineStore),
    },
    candidate: {
      evidenceId: 'qa-candidate-001',
      observedAt: '2026-10-02T18:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic fixture: not a real retailer observation',
      basket: makeBasket(candidateStore, candidateOffset, omitExtra),
    },
  }
}

// Freeze only fresh owned plain-data fixtures, never arbitrary caller Proxies.
// Object.freeze itself is not safe as an untrusted-Proxy admission check.
function freezeOwnedPlain(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeOwnedPlain(child)
    Object.freeze(value)
  }
  return value
}

for (const [outcome, centsOffset] of [
  ['same', 0],
  ['better', -10],
  ['worse', 10],
]) {
  test(`M3 validated frozen plain basket yields stable ${outcome} report without public claim`, () => {
    const input = freezeOwnedPlain(study(centsOffset))
    const original = JSON.stringify(input)
    const baseline = input.baseline.basket
    const candidate = input.candidate.basket

    assert.equal(baseline.unresolvedLineCount, 0)
    assert.equal(candidate.unresolvedLineCount, 0)
    assert.ok(baseline.lines.length >= 10)
    assert.equal(baseline.lines.length, candidate.lines.length)

    const first = buildObservedWeekReport(input)
    const second = buildObservedWeekReport(input)
    const exactDelta = candidate.totalCents - baseline.totalCents

    assert.deepEqual(first, second)
    assert.equal(first.claimable, true)
    assert.equal(first.outcome, outcome)
    assert.equal(first.baselineTotalCents, baseline.totalCents)
    assert.equal(first.candidateTotalCents, candidate.totalCents)
    assert.equal(first.deltaCents, exactDelta)
    assert.equal(first.savingsCents, -exactDelta || 0)
    assert.equal(first.observationWindowHours, 1)
    assert.equal(first.publicSavingsClaimEligible, false)
    assert.equal('participantKey' in first, false)
    assert.equal(JSON.stringify(input), original)
    assert.doesNotMatch(JSON.stringify(first), /qa-private-participant/)
  })
}

test('M3 partial frozen plain basket abstains and cannot carry a savings delta', () => {
  const input = freezeOwnedPlain(study(-10, true))
  const original = JSON.stringify(input)
  assert.ok(input.candidate.basket.unresolvedLineCount > 0)

  const report = buildObservedWeekReport(input)
  assert.equal(report.claimable, false)
  assert.equal(report.outcome, 'unknown')
  assert.equal(report.deltaCents, null)
  assert.equal(report.savingsCents, null)
  assert.equal(report.attribution.status, 'unknown')
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal('participantKey' in report, false)
  assert.equal(JSON.stringify(input), original)
  assert.deepEqual(buildObservedWeekReport(input), report)
})

test('M3 JSON transport preserves all synthetic financial and unknown outcomes', () => {
  for (const [expected, offset, incomplete] of [
    ['better', -10, false],
    ['same', 0, false],
    ['worse', 10, false],
    ['unknown', -10, true],
  ]) {
    // Canonical JSON transport yields fresh ordinary data, not an
    // attacker-supplied accessor/Proxy and not human field observations.
    const input = JSON.parse(JSON.stringify(study(offset, incomplete)))
    const original = JSON.stringify(input)
    const report = buildObservedWeekReport(input)

    assert.equal(report.outcome, expected)
    assert.equal(report.claimable, !incomplete)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal('participantKey' in report, false)
    assert.equal(JSON.stringify(input), original)
    assert.equal(
      report.deltaCents,
      incomplete
        ? null
        : input.candidate.basket.totalCents - input.baseline.basket.totalCents,
    )
    assert.equal(
      report.savingsCents,
      incomplete ? null : -(report.deltaCents) || 0,
    )
  }
})

test('plain physical candidate row reordering cannot change a same-demand M3 money decision', () => {
  for (const offset of [-10, 0, 10]) {
    const input = study(offset)
    const ordered = buildObservedWeekReport(input)
    const originalBaseline = JSON.stringify(input.baseline)
    input.candidate.basket.lines.reverse()
    const shuffled = freezeOwnedPlain(input)
    const reordered = buildObservedWeekReport(shuffled)

    assert.equal(ordered.claimable, true)
    assert.equal(reordered.claimable, true)
    assert.equal(reordered.outcome, ordered.outcome)
    assert.equal(reordered.deltaCents, ordered.deltaCents)
    assert.equal(reordered.savingsCents, ordered.savingsCents)
    assert.equal(reordered.publicSavingsClaimEligible, false)
    assert.equal(JSON.stringify(shuffled.baseline), originalBaseline)
  }
})

test('M3 plain price recheck recalculates cents and does not retroactively alter a prior report', () => {
  const input = study(0)
  const unchangedBaseline = JSON.stringify(input.baseline)
  const previous = buildObservedWeekReport(input)
  const previousSerialized = JSON.stringify(previous)

  assert.equal(previous.outcome, 'same')
  assert.equal(previous.deltaCents, 0)
  assert.equal(previous.savingsCents, 0)
  assert.equal(previous.publicSavingsClaimEligible, false)

  // This is a legal, sequentially updated *ordinary* input between calls,
  // not a Proxy descriptor mutation while one comparison is in progress.
  const line = input.candidate.basket.lines.find((item) => item.status === 'matched')
  assert.ok(line)
  const boughtPacks = line.packs
  assert.ok(Number.isSafeInteger(boughtPacks) && boughtPacks > 0)
  line.pricePerPackCents += 1
  line.lineTotalCents += boughtPacks
  input.candidate.basket.totalCents += boughtPacks

  const next = buildObservedWeekReport(input)
  assert.equal(next.claimable, true)
  assert.equal(next.outcome, 'worse')
  assert.equal(next.deltaCents, boughtPacks)
  assert.equal(next.savingsCents, -boughtPacks)
  assert.equal(next.publicSavingsClaimEligible, false)
  assert.equal(JSON.stringify(previous), previousSerialized)
  assert.equal(JSON.stringify(input.baseline), unchangedBaseline)
  assert.equal('participantKey' in next, false)
})
