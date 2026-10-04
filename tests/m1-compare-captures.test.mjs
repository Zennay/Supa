import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  compareCaptureDirectories,
  compareInspectionReports,
} from '../scripts/m1-compare-captures.mjs'

function source(overrides = {}) {
  return {
    id: 'ah-product',
    supermarket: 'ah',
    kind: 'product',
    success: true,
    finalUrl: 'https://www.ah.nl/product/example',
    manifestSha256: 'a'.repeat(64),
    html: {
      title: 'Milk',
      hasNextData: true,
      jsonLd: [{ type: ['Product'], keys: ['@type', 'name', 'offers'] }],
      applicationJsonScripts: [{ id: '__NEXT_DATA__', bytes: 100 }],
    },
    schemaOrgProduct: {
      type: 'observation',
      observation: {
        sourceProductId: '123',
        currentPriceCents: 129,
        availability: 'available',
        pack: { unit: 'unknown' },
      },
    },
    ...overrides,
  }
}

function report(sources, captureStartedAt = '2026-10-04T00:00:00.000Z') {
  return {
    milestone: 'M1 Data Feasibility',
    captureStartedAt,
    sources,
  }
}

test('treats changing content hash as expected content-only drift when structure is stable', () => {
  const baseline = report([source()])
  const current = report(
    [source({ manifestSha256: 'b'.repeat(64) })],
    '2026-10-05T00:00:00.000Z',
  )

  const result = compareInspectionReports(baseline, current)
  assert.equal(result.reviewRequired, false)
  assert.equal(result.contentOnlyCount, 1)
  assert.equal(result.changes[0].classification, 'content-only')
  assert.deepEqual(result.changes[0].reasons, ['content-hash-changed'])
})

test('requires review when structured markup changes', () => {
  const baseline = report([source()])
  const current = report([
    source({
      manifestSha256: 'b'.repeat(64),
      html: {
        title: 'Milk',
        hasNextData: false,
        jsonLd: [],
        applicationJsonScripts: [],
      },
    }),
  ])

  const result = compareInspectionReports(baseline, current)
  assert.equal(result.reviewRequired, true)
  assert.equal(result.reviewCount, 1)
  assert.ok(result.changes[0].reasons.includes('structured-markup-changed'))
})

test('requires review when capture success regresses', () => {
  const baseline = report([source()])
  const current = report([
    source({
      success: false,
      manifestSha256: null,
      html: null,
      schemaOrgProduct: null,
    }),
  ])

  const result = compareInspectionReports(baseline, current)
  assert.equal(result.reviewRequired, true)
  assert.ok(result.changes[0].reasons.includes('capture-status-changed'))
})

test('ignores volatile application/json byte counts in the structural signature', () => {
  const baseline = report([source()])
  const current = report([
    source({
      manifestSha256: 'b'.repeat(64),
      html: {
        title: 'Milk changed price',
        hasNextData: true,
        jsonLd: [{ type: ['Product'], keys: ['offers', 'name', '@type'] }],
        applicationJsonScripts: [{ id: '__NEXT_DATA__', bytes: 9000 }],
      },
    }),
  ])

  const result = compareInspectionReports(baseline, current)
  assert.equal(result.reviewRequired, false)
  assert.equal(result.changes[0].classification, 'content-only')
})

test('writes drift.json for repeatable capture comparison', async () => {
  const baselineDir = await mkdtemp(path.join(os.tmpdir(), 'supa-m1-baseline-'))
  const currentDir = await mkdtemp(path.join(os.tmpdir(), 'supa-m1-current-'))

  await writeFile(
    path.join(baselineDir, 'inspection.json'),
    JSON.stringify(report([source()])),
    'utf8',
  )
  await writeFile(
    path.join(currentDir, 'inspection.json'),
    JSON.stringify(
      report([source({ manifestSha256: 'b'.repeat(64) })], '2026-10-05T00:00:00.000Z'),
    ),
    'utf8',
  )

  const result = await compareCaptureDirectories(baselineDir, currentDir)
  const written = JSON.parse(
    await readFile(path.join(currentDir, 'drift.json'), 'utf8'),
  )

  assert.equal(result.contentOnlyCount, 1)
  assert.equal(written.reviewRequired, false)
})
