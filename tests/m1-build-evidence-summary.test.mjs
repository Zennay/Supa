import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  buildEvidenceSummary,
  buildEvidenceSummaryFromDirectory,
} from '../scripts/m1-build-evidence-summary.mjs'

const ids = [
  ['ah-product', 'ah', 'product'],
  ['ah-catalog', 'ah', 'catalog'],
  ['ah-offers', 'ah', 'offers'],
  ['plus-product', 'plus', 'product'],
  ['plus-catalog', 'plus', 'catalog'],
  ['plus-offers', 'plus', 'offers'],
]

function bundle({
  failedId = null,
  staleId = null,
  missingInspectionId = null,
} = {}) {
  const manifest = {
    milestone: 'M1 Data Feasibility',
    results: ids.map(([id, supermarket, kind]) => ({
      id,
      supermarket,
      kind,
      success: id !== failedId,
    })),
  }
  const inspection = {
    milestone: 'M1 Data Feasibility',
    sources: ids
      .filter(([id]) => id !== missingInspectionId)
      .map(([id, supermarket, kind]) => ({
        id,
        supermarket,
        kind,
        integrity: id === failedId ? 'not-applicable' : 'verified',
      })),
  }
  const freshness = {
    milestone: 'M1 Data Feasibility',
    sources: ids.map(([id, supermarket, kind]) => ({
      id,
      supermarket,
      kind,
      freshness:
        id === failedId ? 'failed' : id === staleId ? 'stale' : 'fresh',
    })),
  }
  const candidateIndex = {
    candidates: [{ id: 'ah-product' }],
    abstentions: [{ id: 'plus-product' }],
  }
  return { manifest, inspection, freshness, candidateIndex }
}

test('marks a complete two-source evidence bundle adapter-ready', () => {
  const report = buildEvidenceSummary(bundle())

  assert.equal(report.documentConsistency.consistent, true)
  assert.equal(report.captureReady, true)
  assert.equal(report.coverageReady, true)
  assert.equal(report.adapterEvidenceReady, true)
  assert.equal(
    report.nextAction,
    'review-product-candidates-and-build-source-specific-adapters',
  )
  assert.equal(report.evidenceCompleteCount, 6)
})

test('fails readiness when one capture failed', () => {
  const report = buildEvidenceSummary(bundle({ failedId: 'plus-offers' }))

  assert.equal(report.captureReady, false)
  assert.equal(report.coverageReady, false)
  assert.equal(report.adapterEvidenceReady, false)
  assert.ok(
    report.sources
      .find((source) => source.id === 'plus-offers')
      .reasons.includes('capture-failed'),
  )
})

test('fails readiness when one source is stale', () => {
  const report = buildEvidenceSummary(bundle({ staleId: 'ah-catalog' }))

  assert.equal(report.adapterEvidenceReady, false)
  assert.ok(
    report.sources
      .find((source) => source.id === 'ah-catalog')
      .reasons.includes('freshness-stale'),
  )
})

test('detects inconsistent evidence documents', () => {
  const report = buildEvidenceSummary(
    bundle({ missingInspectionId: 'ah-offers' }),
  )

  assert.equal(report.documentConsistency.consistent, false)
  assert.deepEqual(report.documentConsistency.missingInspection, ['ah-offers'])
  assert.equal(report.nextAction, 'repair-evidence-bundle')
})

test('writes evidence-summary.json from an artifact directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'supa-m1-evidence-'))
  const candidatesDir = path.join(root, 'sanitized-candidates')
  await mkdir(candidatesDir, { recursive: true })

  const data = bundle()
  await Promise.all([
    writeFile(
      path.join(root, 'manifest.json'),
      JSON.stringify(data.manifest),
      'utf8',
    ),
    writeFile(
      path.join(root, 'inspection.json'),
      JSON.stringify(data.inspection),
      'utf8',
    ),
    writeFile(
      path.join(root, 'freshness.json'),
      JSON.stringify(data.freshness),
      'utf8',
    ),
    writeFile(
      path.join(candidatesDir, 'index.json'),
      JSON.stringify(data.candidateIndex),
      'utf8',
    ),
  ])

  const report = await buildEvidenceSummaryFromDirectory(root)
  const written = JSON.parse(
    await readFile(path.join(root, 'evidence-summary.json'), 'utf8'),
  )

  assert.equal(report.adapterEvidenceReady, true)
  assert.equal(written.sourceCount, 6)
  assert.equal(written.supermarketCount, 2)
})
