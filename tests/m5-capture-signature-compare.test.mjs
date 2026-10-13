import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  captureShape,
  compareCaptureDirectories,
  compareInspections,
} from '../scripts/m5-compare-capture-signatures.mjs'

const product = (price = '1.29', extraField = '') => [
  '<!doctype html><html><head><title>Fictional product</title>',
  '<script type="application/ld+json">',
  JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Fictional milk',
    sku: 'FIC-1',
    offers: {
      '@type': 'Offer', price, priceCurrency: 'EUR',
      ...(extraField ? { [extraField]: 'fictional' } : {}),
    },
  }),
  '</script></head><body></body></html>',
].join('')

async function capture(html, { hashOverride, success = true } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'supa-m5-shapes-'))
  await mkdir(path.join(dir, 'fictional'), { recursive: true })
  await writeFile(path.join(dir, 'fictional', 'fictional-product.html'), html)
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
    milestone: 'M1 Data Feasibility',
    bounded: true,
    sourceCount: 1,
    results: [{
      id: 'fictional-product',
      supermarket: 'fictional',
      kind: 'product',
      requestedUrl: 'https://example.invalid/fictional-product',
      capturedAt: '2026-10-13T00:00:00.000Z',
      sha256: hashOverride ?? createHash('sha256').update(html).digest('hex'),
      success,
    }],
  }))
  return dir
}

test('M5 offline tool compares hash-verified synthetic snapshots without recording price', async () => {
  const baseline = await capture(product('1.29'))
  const latest = await capture(product('2.89'))
  const report = await compareCaptureDirectories(latest, baseline)
  assert.equal(report.contractVersion, 1)
  assert.equal(report.productionReady, false)
  assert.equal(report.m5Eligible, false)
  assert.equal(report.driftCount, 0)
  assert.equal(report.changes[0].status, 'content_changed_shape_stable')
  assert.equal(report.changes[0].current.captureStatus, 'verified')
  assert.equal(report.changes[0].current.schemaOrgStatus, 'candidate_observation')
  assert.match(report.changes[0].current.shapeSha256, /^[a-f0-9]{64}$/)
  assert.doesNotMatch(JSON.stringify(report), /2\.89|1\.29|Fictional milk|example\.invalid/)
})

test('adding a recognized JSON-LD field changes shape and flags independent review', async () => {
  const baseline = await capture(product('1.29'))
  const latest = await capture(product('1.29').replace(
    '"offers":{',
    '"weight":{"value":"1 kg"},"offers":{',
  ))
  const report = await compareCaptureDirectories(latest, baseline)
  assert.equal(report.changes[0].status, 'shape_changed')
  assert.equal(report.driftCount, 1)
  assert.equal(report.reviewerActionRequired, true)
})

test('invalid or modified manifest SHA never produces a trusted drift report', async () => {
  const dir = await capture(product(), { hashOverride: '0'.repeat(64) })
  await assert.rejects(() => compareCaptureDirectories(dir), /integrity mismatch/)
})

test('baseline is never silently implied and successful snapshots alone never grant rights', async () => {
  const dir = await capture(product())
  const report = await compareCaptureDirectories(dir)
  assert.equal(report.baselineProvided, false)
  assert.equal(report.changes[0].status, 'baseline_missing')
  assert.equal(report.productionReady, false)
})

test('failed captures stay unknown and never become price or extraction proofs', async () => {
  const dir = await capture(product(), { success: false })
  const report = await compareCaptureDirectories(dir)
  assert.equal(report.changes[0].current.captureStatus, 'unavailable')
  assert.equal(report.changes[0].current.shapeSha256, null)
  assert.equal(report.changes[0].current.schemaOrgStatus, 'unknown')
})

test('duplicate IDs and unbounded manifests are rejected without iteration', () => {
  const source = {
    id: 'same', supermarket: 'fictional', kind: 'product',
    success: false,
  }
  assert.throws(() => compareInspections({
    sourceCount: 2, sources: [source, source],
  }), /Duplicate/)
  assert.throws(() => compareInspections({
    sourceCount: 101,
    sources: Array(101).fill(source),
  }), /unbounded/)
})

test('verified input is mandatory before hashing candidate selector shapes', () => {
  assert.throws(() => captureShape({
    id: 'fake', success: true, manifestSha256: 'a'.repeat(64),
    integrity: 'unchecked', html: { jsonLd: [], applicationJsonScripts: [] },
  }), /integrity verification required/)
})

test('shape hash never contains unknown JSON-LD free text and ignores it for drift', () => {
  const source = (unknown) => ({
    id: 'fictional-product', supermarket: 'fictional', kind: 'product',
    success: true, integrity: 'verified', manifestSha256: 'a'.repeat(64),
    html: {
      hasNextData: false,
      applicationJsonScripts: [],
      jsonLd: [{ type: ['Product'], keys: ['name', 'offers', unknown] }],
    },
    schemaOrgProduct: { type: 'observation' },
  })
  assert.equal(captureShape(source('some-private-field')).shapeSha256,
    captureShape(source('another-private-field')).shapeSha256)
})

test('M5 signature review does not create HTML, capture, ingestion, or permissions', async () => {
  const dir = await capture(product())
  const report = await compareCaptureDirectories(dir, dir)
  assert.equal(report.changes[0].status, 'unchanged')
  assert.equal(report.mode, 'offline_capture_signature_review_only')
  assert.equal(report.productionReady, false)
  assert.equal(report.m5Eligible, false)
})
