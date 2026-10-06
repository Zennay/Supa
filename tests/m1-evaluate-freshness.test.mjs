import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  evaluateCaptureDirectory,
  evaluateManifestFreshness,
} from '../scripts/m1-evaluate-freshness.mjs'

function manifest(results) {
  return {
    milestone: 'M1 Data Feasibility',
    results,
  }
}

function result(overrides = {}) {
  return {
    id: 'ah-product',
    supermarket: 'ah',
    kind: 'product',
    success: true,
    status: 200,
    capturedAt: '2026-10-04T00:00:00.000Z',
    etag: '"abc"',
    lastModified: 'Sat, 03 Oct 2026 23:00:00 GMT',
    sha256: 'a'.repeat(64),
    ...overrides,
  }
}

test('empty capture manifests are never freshness-acceptable', () => {
  const report = evaluateManifestFreshness(manifest([]), {
    now: new Date('2026-10-04T01:00:00.000Z'),
  })

  assert.equal(report.sourceCount, 0)
  assert.equal(report.freshCount, 0)
  assert.equal(report.acceptable, false)
})

test('marks a recent successful capture fresh and preserves validators', () => {
  const report = evaluateManifestFreshness(manifest([result()]), {
    now: new Date('2026-10-04T01:00:00.000Z'),
    maxCaptureAgeHours: 24,
  })

  assert.equal(report.acceptable, true)
  assert.equal(report.freshCount, 1)
  assert.equal(report.sources[0].captureAgeHours, 1)
  assert.equal(report.sources[0].validators.etagPresent, true)
  assert.equal(report.sources[0].validators.lastModifiedPresent, true)
  assert.equal(report.sources[0].upstreamLastModifiedAgeHours, 2)
})

test('marks an old capture stale without pretending Last-Modified proves freshness', () => {
  const report = evaluateManifestFreshness(
    manifest([
      result({
        capturedAt: '2026-10-01T00:00:00.000Z',
        lastModified: 'Sun, 04 Oct 2026 00:30:00 GMT',
      }),
    ]),
    {
      now: new Date('2026-10-04T01:00:00.000Z'),
      maxCaptureAgeHours: 24,
    },
  )

  assert.equal(report.acceptable, false)
  assert.equal(report.staleCount, 1)
  assert.equal(report.sources[0].freshness, 'stale')
  assert.ok(report.sources[0].reasons.includes('capture-stale'))
})

test('keeps missing upstream validators explicit instead of failing a fresh capture', () => {
  const report = evaluateManifestFreshness(
    manifest([result({ etag: null, lastModified: null })]),
    {
      now: new Date('2026-10-04T01:00:00.000Z'),
    },
  )

  assert.equal(report.acceptable, true)
  assert.equal(report.unknownValidatorCount, 1)
  assert.deepEqual(report.sources[0].validators, {
    etagPresent: false,
    lastModifiedPresent: false,
  })
  assert.ok(
    report.sources[0].reasons.includes('no-upstream-cache-validator'),
  )
})

test('failed captures are never freshness-acceptable', () => {
  const report = evaluateManifestFreshness(
    manifest([
      result({
        success: false,
        status: 503,
      }),
    ]),
    {
      now: new Date('2026-10-04T01:00:00.000Z'),
    },
  )

  assert.equal(report.acceptable, false)
  assert.equal(report.failedCount, 1)
  assert.equal(report.sources[0].freshness, 'failed')
  assert.ok(report.sources[0].reasons.includes('capture-failed'))
})

test('malformed truthy success flags cannot make capture evidence acceptable', () => {
  for (const success of ['false', 1, {}, []]) {
    const report = evaluateManifestFreshness(
      manifest([result({ success })]),
      {
        now: new Date('2026-10-04T01:00:00.000Z'),
      },
    )

    assert.equal(report.acceptable, false)
    assert.equal(report.failedCount, 1)
    assert.equal(report.sources[0].success, false)
    assert.equal(report.sources[0].freshness, 'failed')
    assert.ok(report.sources[0].reasons.includes('invalid-success-flag'))
    assert.ok(report.sources[0].reasons.includes('capture-failed'))
  }
})

test('writes freshness.json into the capture artifact', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'supa-m1-freshness-'))
  await writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify(manifest([result()])),
    'utf8',
  )

  const report = await evaluateCaptureDirectory(root, {
    now: new Date('2026-10-04T01:00:00.000Z'),
  })
  const written = JSON.parse(
    await readFile(path.join(root, 'freshness.json'), 'utf8'),
  )

  assert.equal(report.acceptable, true)
  assert.equal(written.freshCount, 1)
  assert.equal(written.policy.maxCaptureAgeHours, 24)
})

test('future-dated captures fail freshness instead of being clamped to age zero', () => {
  const report = evaluateManifestFreshness(
    manifest([
      result({
        capturedAt: '2026-10-04T02:00:00.000Z',
      }),
    ]),
    {
      now: new Date('2026-10-04T01:00:00.000Z'),
      maxCaptureAgeHours: 24,
    },
  )

  assert.equal(report.acceptable, false)
  assert.equal(report.futureCount, 1)
  assert.equal(report.sources[0].freshness, 'future')
  assert.equal(report.sources[0].captureAgeHours, 0)
  assert.ok(report.sources[0].reasons.includes('capture-in-future'))
})

test('small capture clock skew remains acceptable within the five-minute tolerance', () => {
  const report = evaluateManifestFreshness(
    manifest([
      result({
        capturedAt: '2026-10-04T01:04:00.000Z',
      }),
    ]),
    {
      now: new Date('2026-10-04T01:00:00.000Z'),
      maxCaptureAgeHours: 24,
    },
  )

  assert.equal(report.acceptable, true)
  assert.equal(report.futureCount, 0)
  assert.equal(report.sources[0].freshness, 'fresh')
  assert.ok(!report.sources[0].reasons.includes('capture-in-future'))
})
