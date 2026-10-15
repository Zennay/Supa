import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { RETAILER_REVIEWED_FIXTURES } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { loadPrivateReviewedCaptureBatch, replayPrivateReviewedCaptureDirectory } from
  '../scripts/retailer-private-reviewed-manifest-replay.mjs'
import { compareReviewedDirectories } from
  '../scripts/retailer-private-reviewed-directory-diff.mjs'
import { comparePrivateRetailerFactChanges } from
  '../scripts/retailer-private-fact-change-review.mjs'

// Dedicated product end-to-end checks pinned on the already merged main with
// both source continuity (#3066) AND two private directories (#3062).
// Local historical fixtures only: no new retailer URL, fetch, rights or live price.
const clock = '2026-10-15T21:00:00.000Z'
async function privateArchive() {
  const directory = await mkdtemp(join(tmpdir(), 'supa-integrated-retailer-'))
  const manifest = {
    schemaVersion: 1, mode: 'private-reviewed-retailer-batch',
    permissionVerified: false, productionEnabled: false,
    publicSavingsClaimEligible: false, sources: [],
  }
  for (const original of RETAILER_REVIEWED_FIXTURES) {
    const bytes = await readFile(new URL('../fixtures/m1/' + original, import.meta.url))
    const data = JSON.parse(bytes.toString('utf8'))
    const file = 'capture-' + manifest.sources.length + '.json'
    await writeFile(join(directory, file), bytes, { mode: 0o600, flag: 'wx' })
    manifest.sources.push({
      file, sha256: createHash('sha256').update(bytes).digest('hex'),
      key: data.source.supermarket + ':' + data.source.kind,
    })
  }
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest),
    { mode: 0o600, flag: 'wx' })
  return { directory, manifest }
}
async function archives() {
  const a = await privateArchive()
  try { return [a, await privateArchive()] }
  catch (e) { await rm(a.directory, { recursive: true, force: true }); throw e }
}
async function clean(rows) {
  await Promise.all(rows.map(r => rm(r.directory, { recursive: true, force: true })))
}
const compare = (a,b) => comparePrivateRetailerFactChanges(a,b,{ referenceTime: clock })
function plusProduct(batch) {
  const result = batch.results.find(x => x.key === 'plus:product' && x.accepted)
  assert.ok(result)
  return result
}
function later(batch, changeSha = false) {
  const result = structuredClone(batch)
  for (const observation of plusProduct(result).observations) {
    observation.provenance.capturedAt = '2026-10-14T12:00:00.000000001Z'
    if (changeSha) observation.provenance.sha256 = 'b'.repeat(64)
  }
  return result
}

test('integrated product main: two real SHA-validated archives remain separate and privately comparable', async () => {
  const pair = await archives()
  try {
    const [replayed, summary] = await Promise.all([
      replayPrivateReviewedCaptureDirectory(pair[0].directory, { referenceTime: clock }),
      compareReviewedDirectories(pair[0].directory, pair[1].directory, { referenceTime: clock }),
    ])
    assert.equal(replayed.acceptedSources, 6)
    assert.equal(replayed.sixShapeCoverageComplete, true)
    assert.equal(summary.comparedProducts, summary.totals.unchanged)
    assert.equal(summary.totals.priceChanged, 0)
    assert.equal(summary.totals.missing, 0)
    assert.equal(summary.productionEnabled, false)
    assert.equal(summary.sourceRightsVerified, false)
    assert.equal(summary.publicSavingsClaimEligible, false)
    assert.equal(summary.externalRequests, 0)
    assert.equal(JSON.stringify(summary).includes('www.plus.nl'), false)
    assert.equal(JSON.stringify(summary).includes('capture-'), false)
  } finally { await clean(pair) }
})

test('integrated product main: matched manifest bytes cannot yield a made-up later price/stock change', async () => {
  const pair = await archives()
  try {
    const previous = await loadPrivateReviewedCaptureBatch(pair[0].directory, { referenceTime: clock })
    const current = later(await loadPrivateReviewedCaptureBatch(pair[1].directory, { referenceTime: clock }))
    const p = plusProduct(current).observations[0]
    p.currentPriceCents = (p.currentPriceCents ?? 150) + 5
    p.availability = p.availability === 'available' ? 'unavailable' : 'available'
    assert.throws(() => compare(previous, current), /Private retailer fact change review refused/u)
  } finally { await clean(pair) }
})

test('integrated product main: complete archive vs omitted or rejected source cannot claim removal', async () => {
  const pair = await archives()
  try {
    const previous = await loadPrivateReviewedCaptureBatch(pair[0].directory, { referenceTime: clock })
    for (const omit of [false, true]) {
      const current = structuredClone(await loadPrivateReviewedCaptureBatch(
        pair[1].directory, { referenceTime: clock }))
      const row = plusProduct(current)
      const removed = row.observations.length
      if (omit) {
        current.results.splice(current.results.indexOf(row), 1)
        current.summary.sources--
      } else {
        current.results[current.results.indexOf(row)] =
          { key: row.key, accepted: false, reason: 'adapter-refused', observations: [] }
        current.summary.rejectedSources++
      }
      current.summary.acceptedSources--
      current.summary.observations -= removed
      current.summary.retailerCounts.plus -= removed
      assert.throws(() => compare(previous, current), /Private retailer fact change review refused/u)
    }
  } finally { await clean(pair) }
})

test('integrated product main: different hypothetical HTML digest can flag private historical change only', async () => {
  const pair = await archives()
  try {
    const before = await loadPrivateReviewedCaptureBatch(pair[0].directory, { referenceTime: clock })
    const after = later(await loadPrivateReviewedCaptureBatch(pair[1].directory,
      { referenceTime: clock }), true)
    const mock = plusProduct(after).observations[0]
    mock.currentPriceCents = (mock.currentPriceCents ?? 150) + 5
    const summary = compare(before, after)
    assert.equal(summary.perShape['plus:product'].priceChanged, 1)
    assert.equal(summary.totals.priceChanged, 1)
    assert.equal(summary.livePricesAvailable, false)
    assert.equal(summary.publicSavingsClaimEligible, false)
    assert.equal(summary.externalRequests, 0)
    assert.equal(JSON.stringify(summary).includes(mock.name), false)
    assert.equal(JSON.stringify(summary).includes(mock.provenance.url), false)
  } finally { await clean(pair) }
})

test('integrated product main: one SHA-mismatched private file prevents any archive review result', async () => {
  const pair = await archives()
  try {
    await writeFile(join(pair[1].directory, 'capture-0.json'), '{"tampered":true}\n',
      { mode: 0o600 })
    await assert.rejects(compareReviewedDirectories(pair[0].directory, pair[1].directory,
      { referenceTime: clock }), /refused/u)
  } finally { await clean(pair) }
})
