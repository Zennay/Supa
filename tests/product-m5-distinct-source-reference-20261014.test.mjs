import assert from 'node:assert/strict'
import test from 'node:test'

import { compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Only invented offline HTML and captures. No network, real prices or people.
const SHA = 'a'.repeat(64)
function product(id = 'invented-local-item') {
  return {
    id, supermarket: 'plus', kind: 'product', success: true,
    integrity: 'verified', manifestSha256: SHA,
    html: { hasNextData: false,
      jsonLd: [{ type: ['Product'], keys: ['@type', 'name'] }],
      applicationJsonScripts: [] },
    schemaOrgProduct: { type: 'observation', observation: { name: 'PRIVATE-FAKE-ITEM' } },
  }
}
function failed(id = 'invented-failed-item') {
  return { id, supermarket: 'plus', kind: 'product', success: false }
}
const cohort = (sources) => ({ sourceCount: sources.length, sources })
function rejectShared(current, baseline) {
  assert.throws(() => compareInspections(current, baseline),
    /^Error: Invalid or unbounded baseline inspection$/)
}
function checkManual(report) {
  const queue = buildOfflineSelectorReviewQueue(report)
  assert.equal(queue.rightsVerified, false)
  assert.equal(queue.selectorVerified, false)
  assert.equal(queue.productionReady, false)
  assert.equal(queue.m5Eligible, false)
  assert.doesNotMatch(JSON.stringify(queue), /PRIVATE-FAKE-ITEM|PRIVATE-INSPECTED-ID/)
  return queue
}

test('distinct nonempty arrays reusing one source object are not independent snapshots', () => {
  const source = product()
  const now = cohort([source])
  const before = cohort([source])
  assert.notStrictEqual(now.sources, before.sources)
  rejectShared(now, before)
})
test('one shared failed inspected source also cannot act as past capture', () => {
  const source = failed()
  rejectShared(cohort([source]), cohort([source]))
})
test('shared source in different slot positions is rejected', () => {
  const shared = product('invented-common')
  rejectShared(cohort([product('invented-a'), shared]),
    cohort([shared, product('invented-b')]))
})
test('shared object hidden among distinct sources is rejected', () => {
  const common = product('invented-common')
  const current = cohort([product('invented-current'), common])
  const past = cohort([product('invented-past'), structuredClone(common)])
  // Replacing the historical copy with one shared object invalidates the cohort.
  past.sources[1] = common
  rejectShared(current, past)
})
test('shared object failure never mutates either source array', () => {
  const shared = product()
  const a = [shared], b = [shared]
  const initial = structuredClone(shared)
  rejectShared(cohort(a), cohort(b))
  assert.strictEqual(a[0], shared)
  assert.strictEqual(b[0], shared)
  assert.deepEqual(shared, initial)
})
test('getter on shared source is never called during identity refusal', () => {
  const shared = product()
  let calls = 0
  Object.defineProperty(shared, 'id', { get() { calls++; throw Error('PRIVATE-INSPECTED-ID') } })
  rejectShared(cohort([shared]), cohort([shared]))
  assert.equal(calls, 0)
})
test('source Proxy get traps are never accessed for the identity decision', () => {
  let calls = 0
  const shared = new Proxy(product(), { get() { calls++; throw Error('PRIVATE-INSPECTED-ID') } })
  rejectShared(cohort([shared]), cohort([shared]))
  assert.equal(calls, 0)
})
test('untrusted historical cohort accessor still rejects before source identity', () => {
  let calls = 0
  const shared = product()
  const historical = cohort([shared])
  Object.defineProperty(historical, 'sources', {
    get() { calls++; throw Error('PRIVATE-INSPECTED-ID') },
  })
  rejectShared(cohort([shared]), historical)
  assert.equal(calls, 0)
})
test('untrusted current cohort accessor still preserves current-error precedence', () => {
  let calls = 0
  const shared = product()
  const current = cohort([shared])
  Object.defineProperty(current, 'sources', {
    get() { calls++; throw Error('PRIVATE-INSPECTED-ID') },
  })
  assert.throws(() => compareInspections(current, cohort([shared])),
    /^Error: Invalid or unbounded current inspection$/)
  assert.equal(calls, 0)
})
test('shared source alias even across independent root and array remains invalid with failed source', () => {
  const shared = failed('invented-failure')
  const one = cohort([shared])
  const two = { sourceCount: 1, sources: Array.of(shared) }
  assert.notStrictEqual(one, two)
  assert.notStrictEqual(one.sources, two.sources)
  rejectShared(one, two)
})
test('two distinct deep copies with identical Product data remain human-only P3', () => {
  const source = product()
  const now = cohort([source])
  const before = cohort([structuredClone(source)])
  const q = checkManual(compareInspections(now, before))
  assert.equal(q.actions[0].status, 'unchanged')
  assert.equal(q.actions[0].priority, 'P3')
})
test('two independently created failed captures remain manual P1 rather than alias error', () => {
  const result = compareInspections(cohort([failed()]), cohort([failed()]))
  const q = checkManual(result)
  assert.equal(q.actions[0].priority, 'P1')
})
test('distinct empty cohorts preserve baselineProvided without false shared-reference refusal', () => {
  const result = compareInspections(cohort([]), cohort([]))
  assert.equal(result.baselineProvided, true)
  assert.equal(result.changes.length, 0)
})
test('no historical argument still creates human P2', () => {
  const q = checkManual(compareInspections(cohort([product()])))
  assert.equal(q.actions[0].priority, 'P2')
})
test('null and undefined historical absence remain human P2', () => {
  for (const value of [null, undefined]) {
    const q = checkManual(compareInspections(cohort([product()]), value))
    assert.equal(q.actions[0].priority, 'P2')
  }
})
test('new failed capture without history still creates human P1', () => {
  const q = checkManual(compareInspections(cohort([failed()])))
  assert.equal(q.actions[0].priority, 'P1')
})
test('unrelated removed historical source still creates human P1', () => {
  const q = checkManual(compareInspections(cohort([]), cohort([product('PRIVATE-INSPECTED-ID')])))
  assert.equal(q.actions[0].status, 'removed')
  assert.equal(q.actions[0].priority, 'P1')
})
test('false or zero baseline remains an invalid supplied historical cohort', () => {
  for (const value of [false, 0, '', Number.NaN]) {
    rejectShared(cohort([product()]), value)
  }
})
test('two independently allocated captures with a changed HTML shape remain manual P1', () => {
  const previous = product()
  const current = structuredClone(previous)
  current.html.jsonLd[0].keys.push('@graph')
  current.manifestSha256 = 'b'.repeat(64)
  const q = checkManual(compareInspections(cohort([current]), cohort([previous])))
  assert.equal(q.actions[0].priority, 'P1')
})
