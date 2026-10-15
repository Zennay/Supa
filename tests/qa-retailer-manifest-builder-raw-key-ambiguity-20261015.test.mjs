import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildPrivateReviewedManifest } from '../scripts/retailer-private-reviewed-manifest-builder.mjs'
import { replayPrivateReviewedCaptureDirectory } from '../scripts/retailer-private-reviewed-manifest-replay.mjs'
import { RETAILER_REVIEWED_FIXTURES } from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Independent QA only. These are six existing historical, reviewed fixture
// shapes, NOT permission to download current retailer data or publish prices.
async function stage() {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-builder-duplicate-'))
  await chmod(dir, 0o700)
  for (let i = 0; i < RETAILER_REVIEWED_FIXTURES.length; i++) {
    const bytes = await readFile(new URL('../fixtures/m1/' + RETAILER_REVIEWED_FIXTURES[i], import.meta.url))
    await writeFile(join(dir, 'capture-' + i + '.json'), bytes, { flag: 'wx', mode: 0o600 })
  }
  return dir
}
const cleanup = dir => rm(dir, { recursive: true, force: true })

async function expectRefusal(edit) {
  const dir = await stage()
  try {
    const path = join(dir, 'capture-0.json')
    const original = await readFile(path, 'utf8')
    const edited = edit(original)
    assert.notEqual(edited, original, 'test must introduce actual raw ambiguity')
    assert.doesNotThrow(() => JSON.parse(edited), 'otherwise this does not test JSON.parse last-wins ambiguity')
    // Semantic last-wins content is exactly the originally reviewed fixture.
    assert.deepEqual(JSON.parse(edited), JSON.parse(original))
    await writeFile(path, edited, { mode: 0o600 })
    const reviewedBytes = await readFile(path)
    assert.equal(createHash('sha256').update(reviewedBytes).digest('hex').length, 64)
    await assert.rejects(buildPrivateReviewedManifest(dir),
      /Private reviewed manifest builder refused/,
      'a valid JSON parse with contradictory duplicate names is not unambiguous source evidence')
    assert.ok(!(await readdir(dir)).includes('manifest.json'),
      'refused inputs must never leave a seemingly valid hash manifest')
  } finally { await cleanup(dir) }
}
function replaceOnce(raw, needle, replacement) {
  assert.ok(raw.includes(needle), 'fixture drift invalidated frozen QA mutation')
  return raw.replace(needle, replacement)
}

test('positive: canonical six historical reviewed evidence files are still pinnable and replayable', async () => {
  const dir = await stage()
  try {
    const made = await buildPrivateReviewedManifest(dir)
    const replay = await replayPrivateReviewedCaptureDirectory(dir)
    assert.equal(made.filesPinned, 6)
    assert.equal(replay.acceptedSources, 6)
    assert.equal(replay.sixShapeCoverageComplete, true)
    assert.equal(replay.permissionVerified, false)
    assert.equal(replay.productionEnabled, false)
    assert.equal(replay.publicSavingsClaimEligible, false)
    assert.equal(replay.externalRequests, 0)
  } finally { await cleanup(dir) }
})

test('raw duplicate adapter version cannot be accepted as a private evidence manifest', () =>
  expectRefusal(raw => replaceOnce(raw, '"version": 1,', '"version": 99, "version": 1,')))

test('raw duplicate retailer identity cannot be accepted as a private evidence manifest', () =>
  expectRefusal(raw => replaceOnce(raw, '"supermarket": "plus",',
    '"supermarket": "dekamarkt", "supermarket": "plus",')))

test('raw duplicate source kind cannot be accepted as a private evidence manifest', () =>
  expectRefusal(raw => replaceOnce(raw, '"kind": "product",',
    '"kind": "offers", "kind": "product",')))

test('raw duplicate source SHA cannot be accepted as a private evidence manifest', () =>
  expectRefusal(raw => raw.replace(/"sha256": "([a-f0-9]{64})"/,
    (_match, hash) => '"sha256": "' + '0'.repeat(64) + '", "sha256": "' + hash + '"')))

test('raw duplicate source URL with credential-bearing first value cannot be accepted', () =>
  expectRefusal(raw => raw.replace(/"url": "(https:\/\/www\.plus\.nl\/[^"]+)"/,
    (_match, url) => '"url": "https://fake:secret@www.plus.nl/product", "url": "' + url + '"')))

test('nested original capture-safety field cannot have contradictory duplicate keys', () =>
  expectRefusal(raw => replaceOnce(raw, '"antiBotBypass": false',
    '"antiBotBypass": true, "antiBotBypass": false')))

test('escaped spelling of an existing object name is still a duplicate', () =>
  expectRefusal(raw => replaceOnce(raw, '"version": 1,',
    '"\\u0076ersion": 99, "version": 1,')))
