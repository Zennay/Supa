import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// QA-only direct-queue admission boundary, entirely fictional in-memory M1.
// The queue accepts public compare reports as a separate exported API.
const parsedHtml = '<script type="application/ld+json">{"@type":"Product","offers":{}}</script>'
const malformedHtml = '<script type="application/ld+json">{no-json</script>'
const hash = s => createHash('sha256').update(s).digest('hex')
function capture({ html = parsedHtml, decision = 'observation', id = 'private-fake-source' } = {}) {
  const schemaOrgProduct = decision === 'observation'
    ? { type: 'observation', observation: { secretPrice: 'NEVER_PRINT_PRIVATE' } }
    : { type: 'abstain' }
  return {
    id, supermarket: 'fictional', kind: 'product',
    success: true, integrity: 'verified', manifestSha256: hash(html),
    html: inspectHtml(html), schemaOrgProduct,
  }
}
function report(now = [capture()], old = null) {
  return compareInspections(
    { sourceCount: now.length, sources: now },
    old === null ? null : { sourceCount: old.length, sources: old },
  )
}
function neverAccept(input) {
  const before = structuredClone(input)
  assert.throws(() => buildOfflineSelectorReviewQueue(input), err =>
    err instanceof Error && err.message === 'Invalid offline capture comparison report' &&
    !err.message.includes('private-fake-source') &&
    !err.message.includes('NEVER_PRINT_PRIVATE'))
  assert.deepEqual(input, before)
}
function admitted(input, priority) {
  const q = buildOfflineSelectorReviewQueue(input)
  assert.equal(q.actions.length, 1)
  assert.equal(q.actions[0].priority, priority)
  assert.match(q.actions[0].sourceToken, /^[a-f0-9]{64}$/)
  assert.notEqual(q.actions[0].sourceToken, 'private-fake-source')
  assert.equal(q.m5Eligible, false)
  assert.equal(q.productionReady, false)
  assert.equal(q.rightsVerified, false)
  assert.equal(q.selectorVerified, false)
  assert.equal(q.actions[0].productionEnabled, false)
  assert.equal(q.actions[0].rightsVerified, false)
  assert.equal(q.actions[0].selectorVerified, false)
  assert.doesNotMatch(JSON.stringify(q), /private-fake-source|NEVER_PRINT_PRIVATE|fictional/)
  return q
}

// Canonical positive controls: a real local M1 HTML parser, still no retailer.
test('direct review: real fictional parsed Product is a manual P2', () => {
  const r = report()
  assert.equal(r.changes[0].current.jsonLdCount, 1)
  assert.equal(r.changes[0].current.jsonLdParseErrors, 0)
  assert.equal(r.changes[0].current.schemaOrgStatus, 'candidate_observation')
  admitted(r, 'P2')
})
test('direct review: real fictional parsed Product stable baseline remains P3', () => {
  const c = capture()
  admitted(report([c], [structuredClone(c)]), 'P3')
})
test('direct review: canonical empty-HTML abstain remains valid P2', () => {
  admitted(report([capture({ html: '', decision: 'abstain' })]), 'P2')
})
test('direct review: canonical malformed-JSON-LD abstain remains valid P2', () => {
  const r = report([capture({ html: malformedHtml, decision: 'abstain' })])
  assert.equal(r.changes[0].current.jsonLdParseErrors, 1)
  admitted(r, 'P2')
})
test('direct review: candidate with successful JSON-LD after parse error remains P2', () => {
  const c = capture({ html: malformedHtml + parsedHtml })
  admitted(report([c]), 'P2')
})

// Independent expected-source RED cases. Every mutation is only to the
// public direct-review report AFTER a canonical compare produced valid shape.
test('reject zero JSON-LD when forged candidate is presented directly', () => {
  const r = report()
  r.changes[0].current.jsonLdCount = 0
  r.changes[0].current.jsonLdParseErrors = 0
  neverAccept(r)
})
test('reject candidate when all 1 of 1 JSON-LD records failed', () => {
  const r = report()
  r.changes[0].current.jsonLdCount = 1
  r.changes[0].current.jsonLdParseErrors = 1
  neverAccept(r)
})
test('reject candidate when all 128 of 128 bounded JSON-LD records failed', () => {
  const r = report()
  r.changes[0].current.jsonLdCount = 128
  r.changes[0].current.jsonLdParseErrors = 128
  neverAccept(r)
})
test('reject no-JSON-LD abstain relabeled into candidate before direct queue', () => {
  const r = report([capture({ html: '', decision: 'abstain' })])
  r.changes[0].current.schemaOrgStatus = 'candidate_observation'
  neverAccept(r)
})
test('reject all-failed JSON-LD abstain relabeled into candidate before direct queue', () => {
  const r = report([capture({ html: malformedHtml, decision: 'abstain' })])
  r.changes[0].current.schemaOrgStatus = 'candidate_observation'
  neverAccept(r)
})
test('reject zero-success candidate on BOTH sides of unchanged P3 baseline', () => {
  const c = capture()
  const r = report([c], [structuredClone(c)])
  for (const value of [r.changes[0].current, r.changes[0].baseline]) {
    value.jsonLdCount = 0
    value.jsonLdParseErrors = 0
  }
  assert.equal(r.changes[0].status, 'unchanged')
  neverAccept(r)
})
test('reject zero-success historical candidate from removed-source P1', () => {
  const r = report([], [capture()])
  assert.equal(r.changes[0].status, 'removed')
  r.changes[0].baseline.jsonLdCount = 1
  r.changes[0].baseline.jsonLdParseErrors = 1
  neverAccept(r)
})
test('reject zero-success candidate in genuine changed-HTML P1', () => {
  const r = report([capture()], [capture({ html: malformedHtml, decision: 'abstain' })])
  assert.equal(r.changes[0].status, 'shape_changed')
  r.changes[0].current.jsonLdCount = 0
  r.changes[0].current.jsonLdParseErrors = 0
  neverAccept(r)
})
