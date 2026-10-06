import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { exportSanitizedCandidates } from '../scripts/m1-export-sanitized-candidates.mjs'

function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function observationFor(source) {
  return {
    supermarket: source.supermarket,
    sourceProductId: '123',
    name: 'Halfvolle melk',
    currentPriceCents: 129,
    currency: 'EUR',
    pack: { rawText: null, amount: null, unit: 'unknown' },
    offer: null,
    availability: 'available',
    provenance: {
      supermarket: source.supermarket,
      kind: source.kind,
      url: source.finalUrl,
      capturedAt: source.capturedAt,
      sha256: source.manifestSha256,
    },
  }
}

async function writeInspection(root, sources) {
  await writeFile(
    path.join(root, 'inspection.json'),
    JSON.stringify({
      milestone: 'M1 Data Feasibility',
      captureStartedAt: '2026-10-04T00:00:00.000Z',
      captureCompletedAt: '2026-10-04T00:01:00.000Z',
      sources,
    }),
    'utf8',
  )
}

test('exports only sanitized trusted product observations with capture provenance', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'supa-m1-candidates-'))
  const source = {
    id: 'ah-product',
    supermarket: 'ah',
    kind: 'product',
    success: true,
    integrity: 'verified',
    requestedUrl: 'https://www.ah.nl/producten/product/example',
    finalUrl: 'https://www.ah.nl/producten/product/example',
    capturedAt: '2026-10-04T00:00:30.000Z',
    manifestSha256: 'a'.repeat(64),
  }
  source.schemaOrgProduct = {
    type: 'observation',
    observation: observationFor(source),
  }

  await writeInspection(root, [source])
  const index = await exportSanitizedCandidates(root)

  assert.equal(index.candidateCount, 1)
  assert.equal(index.abstentionCount, 0)

  const candidatePath = path.join(
    root,
    'sanitized-candidates',
    'ah-product.json',
  )
  const serialized = await readFile(candidatePath, 'utf8')
  const candidate = JSON.parse(serialized)
  assert.equal(candidate.source.sha256, source.manifestSha256)
  assert.equal(candidate.observation.name, 'Halfvolle melk')
  assert.equal('html' in candidate, false)
  assert.equal(index.candidates[0].candidateSha256, sha256Text(serialized))
})

test('fails instead of exporting an observation whose provenance drifted', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'supa-m1-candidates-bad-'))
  const source = {
    id: 'plus-product',
    supermarket: 'plus',
    kind: 'product',
    success: true,
    integrity: 'verified',
    requestedUrl: 'https://www.plus.nl/product/example',
    finalUrl: 'https://www.plus.nl/product/example',
    capturedAt: '2026-10-04T00:00:30.000Z',
    manifestSha256: 'b'.repeat(64),
  }
  const observation = observationFor(source)
  observation.provenance.sha256 = 'c'.repeat(64)
  source.schemaOrgProduct = { type: 'observation', observation }

  await writeInspection(root, [source])

  await assert.rejects(
    () => exportSanitizedCandidates(root),
    /Provenance mismatch/,
  )
})

test('records product abstentions without exporting guessed fixtures', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'supa-m1-candidates-none-'))
  await writeInspection(root, [
    {
      id: 'ah-product',
      supermarket: 'ah',
      kind: 'product',
      success: true,
      integrity: 'verified',
      schemaOrgProduct: {
        type: 'abstain',
        reasons: ['no Product JSON-LD node'],
      },
    },
  ])

  const index = await exportSanitizedCandidates(root)
  assert.equal(index.candidateCount, 0)
  assert.equal(index.abstentionCount, 1)
  assert.deepEqual(index.abstentions[0].reasons, [
    'no Product JSON-LD node',
  ])
})

test('rejects malformed product success flags before candidate export', async () => {
  for (const success of ['false', 1, {}, []]) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'supa-m1-candidates-success-'))
    const source = {
      id: 'plus-product',
      supermarket: 'plus',
      kind: 'product',
      success,
      integrity: 'verified',
      requestedUrl: 'https://www.plus.nl/product/example',
      finalUrl: 'https://www.plus.nl/product/example',
      capturedAt: '2026-10-04T00:00:30.000Z',
      manifestSha256: 'b'.repeat(64),
    }
    source.schemaOrgProduct = {
      type: 'observation',
      observation: observationFor(source),
    }

    await writeInspection(root, [source])

    await assert.rejects(
      () => exportSanitizedCandidates(root),
      /invalid product success flag/,
    )
  }
})

test('rejects unsafe product source ids before writing sanitized candidate paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'supa-m1-candidates-unsafe-'))
  const source = {
    id: '../ah-product',
    supermarket: 'ah',
    kind: 'product',
    success: true,
    integrity: 'verified',
    requestedUrl: 'https://www.ah.nl/producten/product/example',
    finalUrl: 'https://www.ah.nl/producten/product/example',
    capturedAt: '2026-10-04T00:00:30.000Z',
    manifestSha256: 'a'.repeat(64),
  }
  source.schemaOrgProduct = {
    type: 'observation',
    observation: observationFor(source),
  }

  await writeInspection(root, [source])

  await assert.rejects(
    () => exportSanitizedCandidates(root),
    /unsafe product source id/,
  )
})

test('rejects duplicate product source ids before candidate files can overwrite each other', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'supa-m1-candidates-duplicate-'))
  const first = {
    id: 'ah-product',
    supermarket: 'ah',
    kind: 'product',
    success: true,
    integrity: 'verified',
    requestedUrl: 'https://www.ah.nl/producten/product/example',
    finalUrl: 'https://www.ah.nl/producten/product/example',
    capturedAt: '2026-10-04T00:00:30.000Z',
    manifestSha256: 'a'.repeat(64),
  }
  first.schemaOrgProduct = {
    type: 'observation',
    observation: observationFor(first),
  }
  const second = {
    ...first,
    finalUrl: 'https://www.ah.nl/producten/product/other',
    manifestSha256: 'b'.repeat(64),
  }
  second.schemaOrgProduct = {
    type: 'observation',
    observation: observationFor(second),
  }

  await writeInspection(root, [first, second])

  await assert.rejects(
    () => exportSanitizedCandidates(root),
    /duplicate product source id/,
  )
})
