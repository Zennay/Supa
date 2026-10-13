import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// Synthetic local SHA-verified M1 manifest -> real offline M5 queue CLI.
// Never accesses a retailer, proxies, real prices, or external resources.
const SOURCE = 'fictional-source'
const STORE = 'fictional-store'
const SOURCE_URL = 'https://example.invalid/fake'

async function withManifest(value, callback) {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-raw-success-'))
  const html = '<!doctype html><html><body>fictional local fixture</body></html>'
  const sha256 = createHash('sha256').update(html).digest('hex')
  const storeDir = join(root, STORE)
  const manifestPath = join(root, 'manifest.json')
  try {
    await mkdir(storeDir)
    await writeFile(join(storeDir, SOURCE + '.html'), html)
    const row = {
      id: SOURCE, supermarket: STORE, kind: 'product',
      requestedUrl: SOURCE_URL, capturedAt: '2026-10-13T00:00:00.000Z',
      sha256,
    }
    if (value !== 'OMIT_SUCCESS') row.success = value
    const raw = JSON.stringify({
      milestone: 'M1 Data Feasibility', bounded: true,
      sourceCount: 1, results: [row],
    })
    await writeFile(manifestPath, raw)
    const cli = new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url).pathname
    const outcome = spawnSync(process.execPath,
      ['--experimental-strip-types', cli, root],
      { encoding: 'utf8', timeout: 10000 })
    await callback(outcome)
    assert.equal(await readFile(manifestPath, 'utf8'), raw,
      'offline input manifest must never be modified')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function assertManualOnly(outcome, expectedPriority, expectedAction) {
  assert.equal(outcome.status, 0, outcome.stderr)
  assert.equal(outcome.stderr, '')
  const queue = JSON.parse(outcome.stdout)
  assert.equal(queue.actions.length, 1)
  assert.equal(queue.actions[0].priority, expectedPriority)
  assert.equal(queue.actions[0].action, expectedAction)
  assert.equal(queue.productionReady, false)
  assert.equal(queue.m5Eligible, false)
  assert.equal(queue.rightsVerified, false)
  assert.equal(queue.selectorVerified, false)
  assert.equal(queue.actions[0].productionEnabled, false)
  assert.doesNotMatch(outcome.stdout, /fictional-source|fictional-store|example\.invalid/)
}

function assertFailClosed(outcome) {
  assert.notEqual(outcome.status, 0, 'nonboolean raw manifest must not become a review queue')
  assert.equal(outcome.stdout, '', 'no trustworthy JSON review action may be published')
  assert.match(outcome.stderr, /Offline review failed: invalid capture or report/)
  assert.doesNotMatch(outcome.stderr,
    /fictional-source|fictional-store|example\.invalid|supa-m5-raw-success/)
}

test('M5 raw-manifest QA positive: real CLI accepts canonical boolean true with local SHA verification', async () => {
  await withManifest(true, outcome =>
    assertManualOnly(outcome, 'P2', 'establish_approved_baseline'))
})

test('M5 raw-manifest QA positive: real CLI classifies canonical boolean false as P1 unavailable', async () => {
  await withManifest(false, outcome =>
    assertManualOnly(outcome, 'P1', 'recapture_or_investigate_failure'))
})

test('M5 raw-manifest QA RED: quoted true must not be coerced to verified capture', async () => {
  await withManifest('true', assertFailClosed)
})

test('M5 raw-manifest QA RED: quoted false must not be coerced to verified capture', async () => {
  await withManifest('false', assertFailClosed)
})

test('M5 raw-manifest QA RED: numeric and string numeric success cannot be trusted', async () => {
  for (const value of [1, '1']) {
    await withManifest(value, assertFailClosed)
  }
})

test('M5 raw-manifest QA RED: null and absent success cannot silently mean failed capture', async () => {
  for (const value of [null, 'OMIT_SUCCESS']) {
    await withManifest(value, assertFailClosed)
  }
})
