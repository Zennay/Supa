import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Independent QA original-RED contract; deliberately pinned to #2342, BEFORE product #2343 fix.
// Every capture is fictional, in-memory, private; absolutely no retailer I/O.
const html = '<script type="application/ld+json">{"@type":"Product","name":"Fictional"}</script>'
const SHA = createHash('sha256').update(html).digest('hex')
const SECRET = 'NEVER-EXPOSE-QA-SOURCE'
function source(id = 'fictional-source') {
  return {
    id, supermarket: 'fictional', kind: 'product', success: true,
    integrity: 'verified', manifestSha256: SHA, html: inspectHtml(html),
    schemaOrgProduct: { type: 'observation', observation: { name: SECRET } },
  }
}
function failed(id = 'fictional-failure') {
  return { id, supermarket: 'fictional', kind: 'product', success: false }
}
const cohort = sources => ({ sourceCount: sources.length, sources })
function reject(now, past) {
  assert.throws(() => compareInspections(now, past),
    error => error instanceof Error &&
      error.message === 'Invalid or unbounded baseline inspection' &&
      !error.message.includes(SECRET) &&
      !error.message.includes('fictional-source'))
}
function mustRemainManual(now, past, priority) {
  const q = buildOfflineSelectorReviewQueue(compareInspections(now, past))
  assert.equal(q.actions.length, 1)
  assert.equal(q.actions[0].priority, priority)
  assert.equal(q.rightsVerified, false)
  assert.equal(q.selectorVerified, false)
  assert.equal(q.productionReady, false)
  assert.equal(q.m5Eligible, false)
  assert.doesNotMatch(JSON.stringify(q), /NEVER-EXPOSE-QA-SOURCE|fictional-source/)
}
test('QA control: two independent sources with identical fictional bytes can be reviewed as P3, not released', () => {
  const now = source()
  mustRemainManual(cohort([now]), cohort([structuredClone(now)]), 'P3')
})
test('QA control: null historical cohort remains human-only P2', () => {
  mustRemainManual(cohort([source()]), null, 'P2')
})
test('QA control: separate empty historical cohorts remain valid and always gated', () => {
  const r = compareInspections(cohort([]), cohort([]))
  assert.equal(r.baselineProvided, true)
  assert.equal(r.productionReady, false)
  assert.equal(r.m5Eligible, false)
})
test('QA control: already forbidden same sources-array identity stays rejected', () => {
  const list = [source()]
  reject(cohort(list), cohort(list))
})
test('QA original RED: same Product object in two different arrays is not independent history', () => {
  const s = source()
  reject(cohort([s]), cohort([s]))
})
test('QA original RED: same unavailable capture object in two different arrays is not independent history', () => {
  const s = failed()
  reject(cohort([s]), cohort([s]))
})
test('QA original RED: shared Product reference across independently cloned companion captures cannot pass', () => {
  const common = source('common')
  const now = cohort([common, source('other')])
  const past = cohort([structuredClone(source('other')), common])
  reject(now, past)
})
test('QA original RED: shared record can move between independent current and historical array slots', () => {
  const reused = source('reused')
  reject(cohort([source('a'), reused]), cohort([reused, source('a')]))
})
test('QA original RED: one shared source amongst otherwise independent records invalidates cohort', () => {
  const reused = source('reused')
  reject(cohort([reused, source('now-only')]), cohort([reused, source('past-only')]))
})
test('QA original RED: frozen distinct arrays do not make a reused mutable source independent', () => {
  const reused = source()
  reject(cohort(Object.freeze([reused])), cohort(Object.freeze([reused])))
})
test('QA original RED: source accessor must not execute before shared object identity is rejected', () => {
  const reused = source()
  let getterCalls = 0
  Object.defineProperty(reused, 'id', { get() { getterCalls++; throw Error(SECRET) } })
  reject(cohort([reused]), cohort([reused]))
  assert.equal(getterCalls, 0)
})
test('QA original RED: swapped current and history wrappers cannot launder shared unavailable source', () => {
  const reused = failed()
  const now = cohort([failed('other'), reused])
  const past = cohort([reused, failed('other')])
  reject(now, past)
})
