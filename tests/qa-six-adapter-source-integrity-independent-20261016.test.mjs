import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  RETAILER_REVIEWED_FIXTURES,
  ingestReviewedBatch,
  ingestReviewedEvidence,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Independent acceptance on the product owner's exact six-adapter snapshot branch.
// All six captures are archived, reviewed M1 fixtures. No HTTP, current-price
// inference, artificial license, field-user record or public savings claim.
async function originals() {
  return Promise.all(RETAILER_REVIEWED_FIXTURES.map(async file => JSON.parse(
    await readFile(new URL('../fixtures/m1/' + file, import.meta.url), 'utf8'),
  )))
}

function privacyAndRightsStayDenied(summary) {
  assert.equal(summary.mode, 'reviewed-offline-only')
  assert.equal(summary.productionEnabled, false)
  assert.equal(summary.permissionVerified, false)
  assert.equal(summary.publicSavingsClaimEligible, false)
  assert.equal(Object.hasOwn(summary, 'savingsCents'), false)
  assert.equal(Object.hasOwn(summary, 'currentPriceCents'), false)
}

test('all six real archived adapter shapes remain accepted with exact source provenance', async () => {
  const captures = await originals()
  const pristine = structuredClone(captures)
  const { summary, results } = ingestReviewedBatch(captures)

  assert.equal(RETAILER_REVIEWED_FIXTURES.length, 6)
  assert.equal(summary.sources, 6)
  assert.equal(summary.acceptedSources, 6)
  assert.equal(summary.rejectedSources, 0)
  assert.ok(summary.observations >= 6)
  assert.ok(summary.retailerCounts.plus > 0)
  assert.ok(summary.retailerCounts.dekamarkt > 0)
  privacyAndRightsStayDenied(summary)
  assert.equal(results.length, 6)

  for (let i = 0; i < captures.length; i++) {
    const item = captures[i]
    const result = results[i]
    assert.equal(result.key, item.source.supermarket + ':' + item.source.kind)
    assert.equal(result.accepted, true, RETAILER_REVIEWED_FIXTURES[i])
    assert.equal(result.reason, null)
    assert.ok(result.observations.length > 0)
    for (const observation of result.observations) {
      assert.equal(observation.provenance.supermarket, item.source.supermarket)
      assert.equal(observation.provenance.kind, item.source.kind)
      assert.equal(observation.provenance.url, item.source.url)
      assert.equal(observation.provenance.capturedAt, item.source.capturedAt)
      assert.equal(observation.provenance.sha256, item.source.sha256)
    }
  }
  assert.deepEqual(captures, pristine, 'caller-owned historical captures must remain untouched')
})

test('the six archived sources are order-independent without retailer or shape mixing', async () => {
  const captures = await originals()
  const reference = ingestReviewedBatch(captures)
  const expected = new Map(reference.results.map(result => [result.key, result]))
  for (let rotation = 0; rotation < 6; rotation++) {
    const order = captures.slice(rotation).concat(captures.slice(0, rotation))
    const actual = ingestReviewedBatch(order)
    assert.deepEqual(actual.summary, reference.summary, 'rotated full-batch summary')
    assert.equal(actual.results.length, 6)
    for (const result of actual.results) {
      assert.deepEqual(result, expected.get(result.key), 'original exact provenance and money facts')
    }
  }
  for (const permuted of [captures.toReversed(), [captures[1], captures[3], captures[5], captures[0], captures[2], captures[4]]]) {
    const actual = ingestReviewedBatch(permuted)
    assert.deepEqual(actual.summary, reference.summary)
    for (const result of actual.results) assert.deepEqual(result, expected.get(result.key))
  }
})

test('every adapter rejects forged retailer, capture kind, evidence type, version and ID', async () => {
  const captures = await originals()
  for (let i = 0; i < captures.length; i++) {
    const original = captures[i]
    for (const mutate of [
      item => { item.source.supermarket = 'not-an-approved-store' },
      item => { item.source.kind = 'unreviewed-html' },
      item => { item.evidenceType = 'not-the-versioned-adapter-evidence' },
      item => { item.version = 999 },
      item => { item.source.id = 'unsafe:capture' },
      item => { item.source.id = 'a'.repeat(129) },
    ]) {
      const changed = structuredClone(original)
      mutate(changed)
      assert.throws(
        () => ingestReviewedEvidence(changed),
        /Unapproved retailer or capture shape|Unsafe source identity/,
        RETAILER_REVIEWED_FIXTURES[i],
      )
      assert.throws(
        () => ingestReviewedBatch([original, changed]),
        /Unapproved retailer or capture shape|Unsafe source identity/,
        'entire reviewed batch must fail before returning anything',
      )
    }
  }
})

test('a hostile late source property is refused before invoking its getter, at every batch position', async () => {
  const captures = await originals()
  for (let position = 1; position < captures.length; position++) {
    const batch = structuredClone(captures)
    let getterCalls = 0
    Object.defineProperty(batch[position].source, 'capturedAt', {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls++
        throw new Error('caller getter must never execute')
      },
    })
    assert.throws(() => ingestReviewedBatch(batch), /Untrusted reviewed source object/)
    assert.equal(getterCalls, 0, 'source getter in record ' + position)
  }
})

test('a late revoked Proxy never invokes a Proxy trap and no first-source result leaks', async () => {
  const captures = await originals()
  let calls = 0
  const { proxy, revoke } = Proxy.revocable(captures[5], {
    ownKeys() { calls++; throw new Error('Proxy ownKeys trap executed') },
    getOwnPropertyDescriptor() { calls++; throw new Error('Proxy descriptor trap executed') },
  })
  revoke()
  const badBatch = captures.slice()
  badBatch[5] = proxy
  assert.throws(() => ingestReviewedBatch(badBatch), /Untrusted reviewed source object/)
  assert.equal(calls, 0)
})

test('duplicate capture identity is refused after preflighting six otherwise valid shapes', async () => {
  const captures = await originals()
  const duplicate = structuredClone(captures[0])
  // Even if the attacker changes the claimed SHA, the key remains the
  // (store, kind, source ID), not a superficial JSON-object identity.
  duplicate.source.sha256 = 'f'.repeat(64)
  assert.throws(
    () => ingestReviewedBatch([...captures, duplicate]),
    /Duplicate reviewed capture identity/,
  )
  assert.equal(ingestReviewedBatch(captures).summary.acceptedSources, 6)
})

test('caller-provided permission/production booleans cannot activate publishing', async () => {
  const captures = await originals()
  const forged = structuredClone(captures)
  for (const capture of forged) {
    capture.productionEnabled = true
    capture.permissionVerified = true
    capture.publicSavingsClaimEligible = true
  }
  const { summary } = ingestReviewedBatch(forged)
  privacyAndRightsStayDenied(summary)
  assert.equal(summary.sources, 6)
})
