import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { parseDekaMarktSsrProductEvidence } from '../src/data/dekaMarktSsrProduct.ts'

const fixtureUrl = new URL(
  '../fixtures/m1/dekamarkt-product-halfvolle-melk.v1.json',
  import.meta.url,
)

async function fixture() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'))
}

test('parses exact public DekaMarkt SSR evidence into a trusted observation', async () => {
  const evidence = await fixture()
  const result = parseDekaMarktSsrProductEvidence(evidence)

  assert.equal(result.type, 'observation')
  assert.equal(result.observation.supermarket, 'dekamarkt')
  assert.equal(result.observation.sourceProductId, '115873')
  assert.equal(result.observation.name, 'Zuivelmeester Halfvolle melk')
  assert.equal(result.observation.currentPriceCents, 85)
  assert.deepEqual(result.observation.pack, {
    rawText: '1 liter',
    amount: 1,
    unit: 'l',
  })
  assert.equal(result.observation.availability, 'available')
  assert.equal(
    result.observation.provenance.sha256,
    '33af1a3f0117c22401309507627d04fc8e8b1044a88180c6230c7cdee8e8c670',
  )
})

test('DekaMarkt evidence fails closed on Nuxt/JSON-LD price disagreement', async () => {
  const evidence = await fixture()
  evidence.jsonLdProduct.offers.Price = 0.99

  assert.deepEqual(parseDekaMarktSsrProductEvidence(evidence), {
    type: 'abstain',
    reason: 'DekaMarkt JSON-LD does not corroborate Nuxt product identity/price',
  })
})

test('DekaMarkt evidence rejects unsafe acquisition metadata', async () => {
  const evidence = await fixture()
  evidence.captureEvidence.safety.antiBotBypass = true

  assert.deepEqual(parseDekaMarktSsrProductEvidence(evidence), {
    type: 'abstain',
    reason: 'DekaMarkt evidence violates the bounded capture contract',
  })
})

test('DekaMarkt evidence rejects malformed source provenance', async () => {
  for (const mutate of [
    (evidence) => { evidence.source.url = 'http://www.dekamarkt.nl/producten/115873' },
    (evidence) => { evidence.source.url = 'https://dekamarkt.nl/producten/115873' },
    (evidence) => { evidence.source.url = 'https://user:pass@www.dekamarkt.nl/producten/115873' },
    (evidence) => { evidence.source.url = 'https://www.dekamarkt.nl:8443/producten/115873' },
    (evidence) => { evidence.source.url = 'https://www.dekamarkt.nl/aanbiedingen' },
    (evidence) => { evidence.source.capturedAt = 'not-a-timestamp' },
    (evidence) => { evidence.source.sha256 = 'not-a-sha' },
  ]) {
    const evidence = await fixture()
    mutate(evidence)
    assert.deepEqual(parseDekaMarktSsrProductEvidence(evidence), {
      type: 'abstain',
      reason: 'DekaMarkt evidence has invalid source provenance',
    })
  }
})

test('DekaMarkt evidence accepts canonical HTML media type with ordinary parameters', async () => {
  const evidence = await fixture()
  evidence.captureEvidence.contentType = ' Text/HTML ; charset=UTF-8 '

  assert.equal(parseDekaMarktSsrProductEvidence(evidence).type, 'observation')
})

test('DekaMarkt evidence rejects deceptive non-HTML content types', async () => {
  for (const contentType of [
    'application/text/html+json',
    'text/html-malformed',
    'text/plain; note=text/html',
    null,
  ]) {
    const evidence = await fixture()
    evidence.captureEvidence.contentType = contentType

    assert.deepEqual(parseDekaMarktSsrProductEvidence(evidence), {
      type: 'abstain',
      reason: 'DekaMarkt evidence violates the bounded capture contract',
    })
  }
})

test('DekaMarkt product requires a timezone-bearing capture timestamp', async () => {
  for (const capturedAt of [
    '2026-10-04',
    '2026-10-04T18:15:29.695',
    '2026-02-30T18:15:29.695Z',
    '2026-10-04T24:00:00Z',
    '2026-10-04T18:15:29+24:00',
  ]) {
    const evidence = await fixture()
    evidence.source.capturedAt = capturedAt

    assert.deepEqual(parseDekaMarktSsrProductEvidence(evidence), {
      type: 'abstain',
      reason: 'DekaMarkt evidence has invalid source provenance',
    })
  }

  const offset = await fixture()
  offset.source.capturedAt = '2026-10-04T20:15:29.695+02:00'
  assert.equal(parseDekaMarktSsrProductEvidence(offset).type, 'observation')
})

test('DekaMarkt product binds corroborated identity to the source URL', async () => {
  const wrongUrlId = await fixture()
  wrongUrlId.source.url =
    'https://www.dekamarkt.nl/producten/zuivel-kaas/melk-karnemelk/zuivelmeester-halfvolle-melk-1-liter/999999'

  assert.deepEqual(parseDekaMarktSsrProductEvidence(wrongUrlId), {
    type: 'abstain',
    reason: 'DekaMarkt product identity does not match source URL',
  })

  const missingUrlId = await fixture()
  missingUrlId.source.url =
    'https://www.dekamarkt.nl/producten/zuivel-kaas/melk-karnemelk/zuivelmeester-halfvolle-melk'

  assert.deepEqual(parseDekaMarktSsrProductEvidence(missingUrlId), {
    type: 'abstain',
    reason: 'DekaMarkt product identity does not match source URL',
  })
})

test('DekaMarkt product rejects unsafe numeric product identities', async () => {
  for (const productId of [0, Number.MAX_SAFE_INTEGER + 1]) {
    const evidence = await fixture()
    evidence.nuxtPayload[5] = productId
    evidence.jsonLdProduct.mpn = productId
    evidence.source.url =
      `https://www.dekamarkt.nl/producten/zuivel-kaas/melk-karnemelk/test-product/${productId}`

    assert.deepEqual(parseDekaMarktSsrProductEvidence(evidence), {
      type: 'abstain',
      reason: 'DekaMarkt Nuxt product fields are incomplete',
    })
  }
})

test('DekaMarkt evidence rejects malformed capture artifact identity', async () => {
  for (const mutate of [
    (evidence) => { evidence.captureEvidence.runId = 0 },
    (evidence) => { evidence.captureEvidence.artifactId = 1.5 },
    (evidence) => { evidence.captureEvidence.artifactDigest = 'sha256:not-a-digest' },
    (evidence) => { evidence.captureEvidence.supaSha = 'f'.repeat(39) },
    (evidence) => { evidence.captureEvidence.bytes = Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    const evidence = await fixture()
    mutate(evidence)
    assert.deepEqual(parseDekaMarktSsrProductEvidence(evidence), {
      type: 'abstain',
      reason: 'DekaMarkt evidence has invalid capture artifact identity',
    })
  }
})
