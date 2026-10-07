import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { parseDekaMarktSsrCatalogEvidence } from '../src/data/dekaMarktSsrListings.ts'
import { parsePlusRenderedCatalogEvidence } from '../src/data/plusRenderedListings.ts'

const plusCatalogUrl = new URL(
  '../fixtures/m1/plus-rendered-catalog.v1.json',
  import.meta.url,
)
const dekaCatalogUrl = new URL(
  '../fixtures/m1/dekamarkt-catalog-melk.v1.json',
  import.meta.url,
)

async function fixture(url) {
  return JSON.parse(await readFile(url, 'utf8'))
}

test('PLUS rendered evidence rejects unsafe integer acquisition metadata', async () => {
  const original = await fixture(plusCatalogUrl)

  for (const field of [
    'runId',
    'artifactId',
    'renderedHtmlBytes',
    'screenshotBytes',
    'observedProductLinkCount',
  ]) {
    const evidence = structuredClone(original)
    evidence.browserEvidence[field] = Number.MAX_SAFE_INTEGER + 1

    assert.deepEqual(parsePlusRenderedCatalogEvidence(evidence), {
      type: 'abstain',
      reason: 'PLUS rendered evidence violates the bounded browser trust contract',
    })
  }
})

test('DekaMarkt evidence rejects unsafe integer acquisition metadata', async () => {
  const original = await fixture(dekaCatalogUrl)

  for (const field of ['runId', 'artifactId', 'bytes']) {
    const evidence = structuredClone(original)
    evidence.captureEvidence[field] = Number.MAX_SAFE_INTEGER + 1

    assert.deepEqual(parseDekaMarktSsrCatalogEvidence(evidence), {
      type: 'abstain',
      reason: 'DekaMarkt evidence violates the bounded capture contract',
    })
  }
})

test('DekaMarkt catalog abstains from unsafe numeric product identities', async () => {
  const evidence = await fixture(dekaCatalogUrl)
  evidence.nuxtPayload[6] = Number.MAX_SAFE_INTEGER + 1

  const result = parseDekaMarktSsrCatalogEvidence(evidence)

  assert.equal(result.type, 'observations')
  assert.equal(result.observations.length, 2)
  assert.equal(result.abstained, 1)
  assert.deepEqual(
    result.observations.map((observation) => observation.sourceProductId),
    ['101229', '6279'],
  )
})
