import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Independent QA 2/2: no retailer requests, real prices, user data or VPS I/O.
const HTML = '<script type="application/ld+json">{"@type":"Product","name":"FICTIONAL"}</script>'
const SECRET = 'PRIVATE-SYNTHETIC-PAYLOAD-NOT-FOR-OUTPUT'
const sha = value => createHash('sha256').update(value).digest('hex')
function capture(id = 'test-product', markup = HTML) {
  return {
    id, supermarket: 'fictional', kind: 'product', success: true,
    integrity: 'verified', manifestSha256: sha(markup), html: inspectHtml(markup),
    schemaOrgProduct: { type: 'observation', observation: { name: SECRET } },
  }
}
function failed(id = 'failed-product') {
  return { id, supermarket: 'fictional', kind: 'product', success: false }
}
const cohort = sources => ({ sourceCount: sources.length, sources })
function refuse(current, baseline, expected = 'Invalid or unbounded baseline inspection') {
  assert.throws(() => compareInspections(current, baseline),
    error => error instanceof Error && error.message === expected &&
      !error.message.includes(SECRET) && !error.message.includes('test-product'))
}
function manual(current, baseline, priority) {
  const report = compareInspections(current, baseline)
  const queue = buildOfflineSelectorReviewQueue(report)
  assert.equal(queue.actions.length, 1)
  assert.equal(queue.actions[0].priority, priority)
  assert.match(queue.actions[0].sourceToken, /^[a-f0-9]{64}$/)
  for (const guard of ['productionReady', 'm5Eligible', 'rightsVerified', 'selectorVerified']) {
    assert.equal(queue[guard], false)
  }
  assert.doesNotMatch(JSON.stringify(queue), /PRIVATE-SYNTHETIC|test-product|fictional/)
  return queue
}

test('QA independent real M1 inspection: separate source objects and source arrays yield manual unchanged P3', () => {
  const current = capture()
  const previous = structuredClone(current)
  assert.notStrictEqual(previous, current)
  manual(cohort([current]), cohort([previous]), 'P3')
})
test('QA distinct empty cohorts count as independently supplied baseline, never release', () => {
  const result = compareInspections(cohort([]), cohort([]))
  assert.equal(result.baselineProvided, true)
  assert.equal(result.captureCount, 0)
  assert.equal(result.changes.length, 0)
  assert.equal(result.productionReady, false)
  assert.equal(result.m5Eligible, false)
})
test('QA omitted baseline stays absent, manual P2', () => {
  manual(cohort([capture()]), undefined, 'P2')
})
test('QA explicitly null baseline stays absent, manual P2', () => {
  manual(cohort([capture()]), null, 'P2')
})
test('QA unavailable current without baseline stays human P1', () => {
  manual(cohort([failed()]), null, 'P1')
})
test('QA historical removal remains human P1 and opaque', () => {
  const q = buildOfflineSelectorReviewQueue(compareInspections(
    cohort([]), cohort([capture('missing-product')])))
  assert.equal(q.actions[0].priority, 'P1')
  assert.equal(q.actions[0].status, 'removed')
  assert.equal(q.m5Eligible, false)
  assert.doesNotMatch(JSON.stringify(q), /missing-product|PRIVATE-SYNTHETIC/)
})
test('QA genuine changed HTML + changed SHA is not falsely unchanged', () => {
  const old = capture()
  const now = capture('test-product', '<script type="application/ld+json">{"@type":"Product","sku":"INVENTED"}</script>')
  manual(cohort([now]), cohort([old]), 'P1')
})
test('QA same source origin with changed supermarket is human P1', () => {
  const old = capture()
  const now = structuredClone(old)
  now.supermarket = 'anotherfictional'
  manual(cohort([now]), cohort([old]), 'P1')
})
test('QA identical cohort object is never its own historical witness', () => {
  const current = cohort([capture()])
  refuse(current, current)
})
test('QA identical empty cohort object is never its own historical witness', () => {
  const current = cohort([])
  refuse(current, current)
})
test('QA distinct cohort wrappers sharing nonempty source-array identity are rejected', () => {
  const sources = [capture()]
  refuse(cohort(sources), cohort(sources))
})
test('QA distinct wrappers sharing empty source-array identity are rejected', () => {
  const sources = []
  refuse(cohort(sources), cohort(sources))
})
test('QA shared source-array identity rejected even with two success captures', () => {
  const sources = [capture(), capture('other-product')]
  refuse(cohort(sources), cohort(sources))
})
test('QA shared array with unavailable capture is rejected', () => {
  const sources = [failed()]
  refuse(cohort(sources), cohort(sources))
})
test('QA identical array used for two disjoint record content changes still cannot be history', () => {
  const sources = [capture()]
  const now = cohort(sources)
  const before = cohort(sources)
  sources[0] = capture('replacement-product')
  refuse(now, before)
})
test('QA rejected shared array does not mutate caller data', () => {
  const sources = [capture()]
  const original = structuredClone(sources)
  refuse(cohort(sources), cohort(sources))
  assert.deepEqual(sources, original)
})
test('QA own current sources accessor is not called before generic rejection', () => {
  const now = cohort([capture()])
  let calls = 0
  Object.defineProperty(now, 'sources', { get() { calls++; throw Error(SECRET) } })
  refuse(now, cohort([capture()]), 'Invalid or unbounded current inspection')
  assert.equal(calls, 0)
})
test('QA own baseline sources accessor is not called before generic rejection', () => {
  const past = cohort([capture()])
  let calls = 0
  Object.defineProperty(past, 'sources', { get() { calls++; throw Error(SECRET) } })
  refuse(cohort([capture()]), past)
  assert.equal(calls, 0)
})
test('QA inherited source arrays are not treated as canonical M1 cohorts', () => {
  const past = { sourceCount: 1 }
  Object.setPrototypeOf(past, { sources: [capture()] })
  refuse(cohort([capture()]), past)
})
test('QA malformed baseline count is rejected before source mapping', () => {
  const past = cohort([capture()])
  past.sourceCount = 2
  refuse(cohort([capture()]), past)
})
test('QA sparse baseline array is not normalized into a false P3', () => {
  const sources = Array(1)
  refuse(cohort([capture()]), cohort(sources))
})
test('QA nullish baselines and forged falsy baselines have distinct contracts', () => {
  for (const x of [false, 0, -0, '', NaN, 0n]) {
    refuse(cohort([capture()]), x)
  }
})
test('QA invalid baseline descriptor takes precedence over private current source getter', () => {
  const now = cohort([capture()])
  let calls = 0
  Object.defineProperty(now.sources[0], 'id', { get() { calls++; throw Error(SECRET) } })
  refuse(now, false)
  assert.equal(calls, 0)
})
test('QA distinct cohorts with a successful and failed sample remain review-only', () => {
  const now = cohort([capture(), failed()])
  const old = cohort([structuredClone(capture()), structuredClone(failed())])
  const q = buildOfflineSelectorReviewQueue(compareInspections(now, old))
  assert.equal(q.actions.length, 2)
  assert.equal(q.actions.some(x => x.priority === 'P1'), true)
  assert.equal(q.actions.some(x => x.priority === 'P3'), true)
  assert.equal(q.rightsVerified, false)
  assert.equal(q.m5Eligible, false)
})
