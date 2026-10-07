import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { parsePlusRenderedProductEvidence } from '../src/data/plusRenderedProduct.ts'

const fixtureUrl = new URL(
  '../fixtures/m1/plus-rendered-product-halfvolle-melk.v1.json',
  import.meta.url,
)

async function fixture() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'))
}

test('parses exact browser-rendered PLUS evidence into a trusted observation', async () => {
  const evidence = await fixture()
  const result = parsePlusRenderedProductEvidence(evidence)

  assert.equal(result.type, 'observation')
  assert.equal(result.observation.supermarket, 'plus')
  assert.equal(result.observation.sourceProductId, '579010')
  assert.equal(result.observation.name, 'Zuivelmeester Halfvolle melk')
  assert.equal(result.observation.currentPriceCents, 85)
  assert.deepEqual(result.observation.pack, {
    rawText: '1000 ml',
    amount: 1000,
    unit: 'ml',
  })
  assert.equal(result.observation.availability, 'available')
  assert.equal(
    result.observation.provenance.sha256,
    'bce1d766ddd5044284104bf9d3247d3302393183ff2ef554fc6d7e5e3e016f5e',
  )
})

test('PLUS rendered evidence fails closed when browser provenance drifts', async () => {
  const evidence = await fixture()
  evidence.browserEvidence.renderedHtmlSha256 = 'a'.repeat(64)

  assert.deepEqual(parsePlusRenderedProductEvidence(evidence), {
    type: 'abstain',
    reason: 'PLUS rendered evidence provenance does not match browser artifact',
  })
})

test('PLUS rendered evidence refuses unsafe acquisition metadata', async () => {
  const evidence = await fixture()
  evidence.browserEvidence.safety.networkInterception = true

  assert.deepEqual(parsePlusRenderedProductEvidence(evidence), {
    type: 'abstain',
    reason: 'PLUS rendered evidence violates the bounded browser safety contract',
  })
})

test('PLUS rendered evidence rejects malformed source provenance', async () => {
  for (const mutate of [
    (evidence) => { evidence.source.url = 'http://www.plus.nl/product/579010' },
    (evidence) => { evidence.source.url = 'https://plus.nl/product/579010' },
    (evidence) => { evidence.source.url = 'https://user:pass@www.plus.nl/product/579010' },
    (evidence) => { evidence.source.capturedAt = 'not-a-timestamp' },
    (evidence) => { evidence.source.sha256 = 'not-a-sha' },
  ]) {
    const evidence = await fixture()
    mutate(evidence)
    assert.deepEqual(parsePlusRenderedProductEvidence(evidence), {
      type: 'abstain',
      reason: 'PLUS rendered evidence has invalid source provenance',
    })
  }
})

test('PLUS rendered evidence rejects malformed browser artifact identity', async () => {
  for (const mutate of [
    (evidence) => { evidence.browserEvidence.runId = 0 },
    (evidence) => { evidence.browserEvidence.runId = 1.5 },
    (evidence) => { evidence.browserEvidence.artifactId = Number.MAX_SAFE_INTEGER + 1 },
    (evidence) => { evidence.browserEvidence.artifactDigest = 'sha256:not-a-digest' },
    (evidence) => { evidence.browserEvidence.supaSha = 'f'.repeat(39) },
  ]) {
    const evidence = await fixture()
    mutate(evidence)
    assert.deepEqual(parsePlusRenderedProductEvidence(evidence), {
      type: 'abstain',
      reason: 'PLUS rendered evidence has invalid browser artifact identity',
    })
  }
})
