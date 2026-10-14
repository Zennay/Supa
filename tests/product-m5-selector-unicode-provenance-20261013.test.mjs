import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Pure, fictional M1 shapes. No real retailer capture or eligibility.
const hashA = 'a'.repeat(64)
const hashB = 'b'.repeat(64)
function snapshot(id, captureStatus = 'verified', schemaOrgStatus = 'abstain') {
  return captureStatus === 'verified'
    ? { id, captureStatus, snapshotSha256: hashA, shapeSha256: hashB, schemaOrgStatus }
    : { id, captureStatus: 'unavailable', snapshotSha256: null, shapeSha256: null, schemaOrgStatus: 'unknown' }
}
function comparison(changes) {
  return {
    contractVersion: 1,
    mode: 'offline_capture_signature_review_only',
    productionReady: false,
    m5Eligible: false,
    reviewerActionRequired: true,
    baselineProvided: true,
    captureCount: changes.filter((entry) => entry.current !== null).length,
    driftCount: changes.filter((entry) => ['added','removed','unavailable','shape_changed'].includes(entry.status)).length,
    changes,
  }
}
const added = (id) => ({ id, status: 'added', current: snapshot(id), baseline: null })

test('valid supplementary Unicode source IDs keep distinct deterministic opaque tokens', () => {
  const changes = [added('valid-😀'), added('valid-🧪'), added('plain-ä')]
  const input = comparison(changes)
  const frozen = JSON.stringify(input)
  const result = buildOfflineSelectorReviewQueue(input)
  assert.equal(result.actions.length, 3)
  assert.equal(new Set(result.actions.map((x) => x.sourceToken)).size, 3)
  for (const action of result.actions) {
    assert.match(action.sourceToken, /^[a-f0-9]{64}$/)
    assert.equal(action.productionEnabled, false)
  }
  assert.deepEqual(result, buildOfflineSelectorReviewQueue(comparison([...changes].reverse())))
  assert.equal(JSON.stringify(input), frozen)
  assert.doesNotMatch(JSON.stringify(result), /valid-|plain-/)
})

test('malformed surrogate at any offset fails closed without input changes', () => {
  for (const id of ['\uD800', 'start-\uD800', '\uDC00-tail', 'wrong-\uD800a',
    'wrong-\uD800\uD800', 'wrong-\uDC00\uDC00']) {
    const input = comparison([added(id)])
    const before = JSON.stringify(input)
    assert.throws(() => buildOfflineSelectorReviewQueue(input), /^Error: Invalid offline capture comparison report$/)
    assert.equal(JSON.stringify(input), before)
  }
})

test('rejects invented verified provenance while retaining the two canonical statuses', () => {
  for (const schemaOrgStatus of ['abstain', 'candidate_observation']) {
    const input = comparison([{
      id: 'canonical', status: 'unchanged',
      current: snapshot('canonical', 'verified', schemaOrgStatus),
      baseline: snapshot('canonical', 'verified', schemaOrgStatus),
    }])
    assert.equal(buildOfflineSelectorReviewQueue(input).actions[0].priority, 'P3')
  }
  for (const schemaOrgStatus of ['unknown', 'production_verified', '', null, undefined]) {
    const input = comparison([added('bad')])
    input.changes[0].current.schemaOrgStatus = schemaOrgStatus
    assert.throws(() => buildOfflineSelectorReviewQueue(input), /Invalid offline capture comparison/)
  }
})

test('rejects unavailable capture with noncanonical hashes/status and retains genuine unavailable', () => {
  const available = snapshot('missing')
  const unavail = snapshot('missing', 'unavailable')
  const before = comparison([{ id: 'missing', status: 'unavailable', current: unavail, baseline: available }])
  assert.equal(buildOfflineSelectorReviewQueue(before).actions[0].priority, 'P1')
  for (const field of ['snapshotSha256', 'shapeSha256', 'schemaOrgStatus']) {
    const current = { ...unavail, [field]: field === 'schemaOrgStatus' ? 'abstain' : hashA }
    assert.throws(() => buildOfflineSelectorReviewQueue(comparison([
      { id: 'missing', status: 'unavailable', current, baseline: available }
    ])), /Invalid offline capture comparison/)
  }
})
