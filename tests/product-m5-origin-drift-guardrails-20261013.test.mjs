import assert from 'node:assert/strict'
import test from 'node:test'
import { compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Synthetic local inspected snapshots only. No live supermarkets or rights.
const sha = 'a'.repeat(64)
function source(supermarket, kind = 'product', success = true) {
  return { id: 'frozen-source', supermarket, kind, success,
    integrity: success ? 'verified' : undefined,
    manifestSha256: success ? sha : undefined,
    html: success ? { hasNextData: false, jsonLd: [], applicationJsonScripts: [] } : undefined,
    ...(success ? { schemaOrgProduct: { type: 'abstain' } } : {}) }
}
const report = (now, before) => compareInspections(
  { sourceCount: 1, sources: [now] },
  { sourceCount: 1, sources: [before] },
)
test('same source and capture category is unchanged; normal content still P2', () => {
  const same = report(source('fictional-a'), source('fictional-a'))
  assert.equal(same.changes[0].status, 'unchanged')
  assert.equal(same.driftCount, 0)
  assert.equal(buildOfflineSelectorReviewQueue(same).actions[0].priority, 'P3')
  const update = source('fictional-a')
  update.manifestSha256 = 'b'.repeat(64)
  const changed = report(update, source('fictional-a'))
  assert.equal(changed.changes[0].status, 'content_changed_shape_stable')
  assert.equal(buildOfflineSelectorReviewQueue(changed).actions[0].priority, 'P2')
})
test('origin takes P1 precedence over reused hashes and failed capture status', () => {
  for (const now of [
    source('fictional-b'),
    source('fictional-a', 'category'),
    source('fictional-b', 'category'),
    source('fictional-b', 'product', false),
  ]) {
    const result = report(now, source('fictional-a'))
    assert.equal(result.changes[0].status, 'origin_changed')
    assert.equal(result.driftCount, 1)
    const queue = buildOfflineSelectorReviewQueue(result)
    assert.deepEqual(queue.actions.map(({ status, action, priority }) =>
      [status, action, priority]),
      [['origin_changed', 'investigate_source_origin_change', 'P1']])
    assert.equal(queue.productionReady, false)
    assert.equal(queue.rightsVerified, false)
    assert.equal(queue.m5Eligible, false)
    assert.doesNotMatch(JSON.stringify(queue), /fictional-a|fictional-b|category/)
  }
})
test('pure queue must reject forged unchanged status across different origins', () => {
  const truth = report(source('fictional-b'), source('fictional-a'))
  for (const status of ['unchanged', 'shape_changed', 'unavailable',
    'content_changed_shape_stable']) {
    const forged = structuredClone(truth)
    forged.changes[0].status = status
    assert.throws(() => buildOfflineSelectorReviewQueue(forged),
      /Invalid offline capture comparison/)
  }
  const fake = report(source('fictional-a'), source('fictional-a'))
  fake.changes[0].status = 'origin_changed'
  fake.driftCount = 1
  assert.throws(() => buildOfflineSelectorReviewQueue(fake), /Invalid offline capture comparison/)
})
test('priorities sort conservatively with stable opaque tokens under multiple sources', () => {
  const originals = [source('fictional-a'), { ...source('fictional-a'), id: 'stable-source' }]
  const changes = [source('fictional-b'), { ...source('fictional-a'), id: 'stable-source' }]
  const comparison = compareInspections(
    { sourceCount: 2, sources: changes },
    { sourceCount: 2, sources: originals },
  )
  const queue = buildOfflineSelectorReviewQueue(comparison)
  assert.deepEqual(queue.actions.map(x => x.priority), ['P1', 'P3'])
  assert.equal(new Set(queue.actions.map(x => x.sourceToken)).size, 2)
})
