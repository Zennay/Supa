import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { promoteReviewedCandidates } from '../scripts/m1-promote-reviewed-candidates.mjs'

function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

async function setupCandidate({ abstain = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'supa-m1-promote-'))
  const sanitizedDir = path.join(root, 'sanitized-candidates')
  await mkdir(sanitizedDir, { recursive: true })

  const source = {
    id: 'ah-product',
    supermarket: 'ah',
    kind: 'product',
    url: 'https://www.ah.nl/product/example',
    capturedAt: '2026-10-04T02:00:00.000Z',
    sha256: 'a'.repeat(64),
  }

  const candidate = {
    version: 1,
    source,
    observation: {
      supermarket: 'ah',
      sourceProductId: '123',
      name: 'Halfvolle melk',
      currentPriceCents: 129,
      currency: 'EUR',
      pack: { rawText: null, amount: null, unit: 'unknown' },
      offer: null,
      availability: 'available',
      provenance: {
        supermarket: 'ah',
        kind: 'product',
        url: source.url,
        capturedAt: source.capturedAt,
        sha256: source.sha256,
      },
    },
  }

  let candidateSha256 = null
  if (!abstain) {
    const serialized = JSON.stringify(candidate, null, 2) + '\n'
    candidateSha256 = sha256Text(serialized)
    await writeFile(
      path.join(sanitizedDir, 'ah-product.json'),
      serialized,
      'utf8',
    )
  }

  await writeFile(
    path.join(sanitizedDir, 'index.json'),
    JSON.stringify({
      milestone: 'M1 Data Feasibility',
      captureStartedAt: '2026-10-04T01:59:00.000Z',
      candidateCount: abstain ? 0 : 1,
      abstentionCount: abstain ? 1 : 0,
      candidates: abstain
        ? []
        : [{ id: source.id, file: 'ah-product.json', candidateSha256 }],
      abstentions: abstain ? [{ id: source.id }] : [],
    }),
    'utf8',
  )

  return { root, source, candidate, candidateSha256 }
}

async function writeReview(root, approval) {
  const file = path.join(root, 'review.json')
  await writeFile(
    file,
    JSON.stringify({ version: 1, approvals: [approval] }),
    'utf8',
  )
  return file
}

function approvalFor(source, overrides = {}) {
  return {
    id: source.id,
    supermarket: source.supermarket,
    url: source.url,
    capturedAt: source.capturedAt,
    sha256: source.sha256,
    decision: 'promote',
    reviewer: 'm1-review',
    reviewedAt: '2026-10-04T02:05:00.000Z',
    notes: 'Observed live candidate accepted as regression evidence.',
    ...overrides,
  }
}

test('promotes an exactly reviewed sanitized candidate without raw html', async () => {
  const { root, source, candidateSha256 } = await setupCandidate()
  const review = await writeReview(root, approvalFor(source))
  const output = path.join(root, 'fixtures')

  const manifest = await promoteReviewedCandidates(root, review, output)

  assert.equal(manifest.promotedCount, 1)
  assert.equal(manifest.promoted[0].candidateSha256, candidateSha256)
  const fixture = JSON.parse(
    await readFile(path.join(output, 'ah-product.json'), 'utf8'),
  )
  assert.equal(fixture.fixtureType, 'reviewed-live-product-observation')
  assert.equal(fixture.source.sha256, source.sha256)
  assert.equal(fixture.review.reviewer, 'm1-review')
  assert.equal('html' in fixture, false)
})

test('rejects review approval when candidate provenance changed', async () => {
  const { root, source } = await setupCandidate()
  const review = await writeReview(
    root,
    approvalFor(source, { sha256: 'b'.repeat(64) }),
  )

  await assert.rejects(
    () => promoteReviewedCandidates(root, review, path.join(root, 'fixtures')),
    /Review mismatch/,
  )
})

test('rejects promotion of an abstained product source', async () => {
  const { root, source } = await setupCandidate({ abstain: true })
  const review = await writeReview(root, approvalFor(source))

  await assert.rejects(
    () => promoteReviewedCandidates(root, review, path.join(root, 'fixtures')),
    /Cannot promote abstained product source/,
  )
})

test('requires explicit reviewer identity and review timestamp', async () => {
  const { root, source } = await setupCandidate()
  const review = await writeReview(
    root,
    approvalFor(source, { reviewer: '', reviewedAt: 'not-a-date' }),
  )

  await assert.rejects(
    () => promoteReviewedCandidates(root, review, path.join(root, 'fixtures')),
    /identify a reviewer/,
  )
})

test('rejects promotion when review predates the captured candidate', async () => {
  const { root, source } = await setupCandidate()
  const review = await writeReview(
    root,
    approvalFor(source, { reviewedAt: '2026-10-04T01:59:59.999Z' }),
  )

  await assert.rejects(
    () => promoteReviewedCandidates(root, review, path.join(root, 'fixtures')),
    /review cannot predate its capture/,
  )
})

test('rejects promotion with an implausibly future-dated review', async () => {
  const { root, source } = await setupCandidate()
  const review = await writeReview(
    root,
    approvalFor(source, { reviewedAt: '2999-01-01T00:00:00.000Z' }),
  )

  await assert.rejects(
    () => promoteReviewedCandidates(root, review, path.join(root, 'fixtures')),
    /implausibly in the future/,
  )
})

test('rejects tampering with a sanitized candidate after export', async () => {
  const { root, source } = await setupCandidate()
  const review = await writeReview(root, approvalFor(source))
  const candidatePath = path.join(
    root,
    'sanitized-candidates',
    'ah-product.json',
  )
  const candidate = JSON.parse(await readFile(candidatePath, 'utf8'))
  candidate.observation.name = 'Tampered product'
  await writeFile(
    candidatePath,
    JSON.stringify(candidate, null, 2) + '\n',
    'utf8',
  )

  await assert.rejects(
    () => promoteReviewedCandidates(root, review, path.join(root, 'fixtures')),
    /candidate integrity mismatch/i,
  )
})

test('rejects an index entry without a candidate integrity hash', async () => {
  const { root, source } = await setupCandidate()
  const review = await writeReview(root, approvalFor(source))
  const indexPath = path.join(root, 'sanitized-candidates', 'index.json')
  const index = JSON.parse(await readFile(indexPath, 'utf8'))
  delete index.candidates[0].candidateSha256
  await writeFile(indexPath, JSON.stringify(index), 'utf8')

  await assert.rejects(
    () => promoteReviewedCandidates(root, review, path.join(root, 'fixtures')),
    /missing a valid candidate SHA-256/,
  )
})

test('refuses to overwrite a reviewed fixture with different provenance', async () => {
  const { root, source } = await setupCandidate()
  const review = await writeReview(root, approvalFor(source))
  const output = path.join(root, 'fixtures')
  await mkdir(output, { recursive: true })
  await writeFile(
    path.join(output, 'ah-product.json'),
    JSON.stringify({
      source: {
        url: source.url,
        capturedAt: '2026-09-01T00:00:00.000Z',
        sha256: 'c'.repeat(64),
      },
    }),
    'utf8',
  )

  await assert.rejects(
    () => promoteReviewedCandidates(root, review, output),
    /Refusing to overwrite reviewed fixture/,
  )
})

test('rejects inconsistent sanitized candidate index metadata before promotion', async () => {
  const { root, source } = await setupCandidate()
  const review = await writeReview(root, approvalFor(source))
  const indexPath = path.join(root, 'sanitized-candidates', 'index.json')
  const index = JSON.parse(await readFile(indexPath, 'utf8'))
  index.candidateCount = 2
  await writeFile(indexPath, JSON.stringify(index), 'utf8')

  await assert.rejects(
    () => promoteReviewedCandidates(root, review, path.join(root, 'fixtures')),
    /declared counts do not match/,
  )
})

test('rejects duplicate or conflicting sanitized candidate decisions before promotion', async () => {
  const { root, source, candidateSha256 } = await setupCandidate()
  const review = await writeReview(root, approvalFor(source))
  const indexPath = path.join(root, 'sanitized-candidates', 'index.json')
  const index = JSON.parse(await readFile(indexPath, 'utf8'))
  index.candidates.push({
    id: source.id,
    file: 'ah-product.json',
    candidateSha256,
  })
  index.candidateCount = 2
  await writeFile(indexPath, JSON.stringify(index), 'utf8')

  await assert.rejects(
    () => promoteReviewedCandidates(root, review, path.join(root, 'fixtures')),
    /duplicate candidate ids/,
  )

  index.candidates = index.candidates.slice(0, 1)
  index.candidateCount = 1
  index.abstentions = [{ id: source.id }]
  index.abstentionCount = 1
  await writeFile(indexPath, JSON.stringify(index), 'utf8')

  await assert.rejects(
    () => promoteReviewedCandidates(root, review, path.join(root, 'fixtures')),
    /candidate\/abstention conflicts/,
  )
})

test('rejects unexpected candidate file paths from the sanitized index', async () => {
  const { root, source } = await setupCandidate()
  const review = await writeReview(root, approvalFor(source))
  const indexPath = path.join(root, 'sanitized-candidates', 'index.json')
  const index = JSON.parse(await readFile(indexPath, 'utf8'))
  index.candidates[0].file = '../ah-product.json'
  await writeFile(indexPath, JSON.stringify(index), 'utf8')

  await assert.rejects(
    () => promoteReviewedCandidates(root, review, path.join(root, 'fixtures')),
    /unexpected candidate file/,
  )
})

test('rejects duplicate promotion approvals for the same source', async () => {
  const { root, source } = await setupCandidate()
  const file = path.join(root, 'review.json')
  const approval = approvalFor(source)
  await writeFile(
    file,
    JSON.stringify({ version: 1, approvals: [approval, approval] }),
    'utf8',
  )

  await assert.rejects(
    () => promoteReviewedCandidates(root, file, path.join(root, 'fixtures')),
    /duplicate promotion approval/,
  )
})
