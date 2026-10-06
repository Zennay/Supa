import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { promoteReviewedCandidates } from '../scripts/m1-promote-reviewed-candidates.mjs'

function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

async function setupPromotion(reviewedAt) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'supa-m1-review-time-'))
  const sanitizedDir = path.join(root, 'sanitized-candidates')
  await mkdir(sanitizedDir, { recursive: true })

  const source = {
    id: 'plus-product',
    supermarket: 'plus',
    kind: 'product',
    url: 'https://www.plus.nl/product/example',
    capturedAt: '2026-10-04T02:00:00.000Z',
    sha256: 'a'.repeat(64),
  }
  const candidate = {
    version: 1,
    source,
    observation: {
      supermarket: 'plus',
      sourceProductId: '123',
      name: 'Halfvolle melk',
      currentPriceCents: 129,
      currency: 'EUR',
      pack: { rawText: null, amount: null, unit: 'unknown' },
      offer: null,
      availability: 'available',
      provenance: {
        supermarket: 'plus',
        kind: 'product',
        url: source.url,
        capturedAt: source.capturedAt,
        sha256: source.sha256,
      },
    },
  }
  const serialized = JSON.stringify(candidate, null, 2) + '\n'
  const candidateSha256 = sha256Text(serialized)
  await writeFile(path.join(sanitizedDir, 'plus-product.json'), serialized, 'utf8')
  await writeFile(
    path.join(sanitizedDir, 'index.json'),
    JSON.stringify({
      milestone: 'M1 Data Feasibility',
      captureStartedAt: '2026-10-04T01:59:00.000Z',
      candidateCount: 1,
      abstentionCount: 0,
      candidates: [{ id: source.id, file: 'plus-product.json', candidateSha256 }],
      abstentions: [],
    }),
    'utf8',
  )

  const reviewFile = path.join(root, 'review.json')
  await writeFile(
    reviewFile,
    JSON.stringify({
      version: 1,
      approvals: [{
        id: source.id,
        supermarket: source.supermarket,
        url: source.url,
        capturedAt: source.capturedAt,
        sha256: source.sha256,
        decision: 'promote',
        reviewer: 'm1-review',
        reviewedAt,
      }],
    }),
    'utf8',
  )

  return { root, reviewFile }
}

test('rejects impossible calendar timestamps in promotion reviews', async () => {
  for (const reviewedAt of [
    '2026-02-30T02:05:00.000Z',
    '2026-13-04T02:05:00.000Z',
  ]) {
    const { root, reviewFile } = await setupPromotion(reviewedAt)

    await assert.rejects(
      () => promoteReviewedCandidates(root, reviewFile, path.join(root, 'fixtures')),
      /approval must include valid reviewedAt/,
      reviewedAt,
    )
  }
})

test('rejects non-ISO date strings even when Date.parse accepts them', async () => {
  const { root, reviewFile } = await setupPromotion('10/04/2026 02:05:00')

  await assert.rejects(
    () => promoteReviewedCandidates(root, reviewFile, path.join(root, 'fixtures')),
    /approval must include valid reviewedAt/,
  )
})
