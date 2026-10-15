import test from 'node:test'
import assert from 'node:assert/strict'
import { validateRawProductObservation } from '../src/data/ingestion.ts'

// Canonical AH product URLs and the earlier M1 fixture alias remain valid;
// shared direct-input validation must still reject navigation/search routes.
const base = {
  supermarket: 'ah',
  sourceProductId: 'fictional-milk',
  name: 'Halfvolle melk',
  currentPriceCents: 129,
  currency: 'EUR',
  pack: { amount: 1000, unit: 'ml', rawText: '1 l' },
  offer: null,
  availability: 'available',
  provenance: {
    supermarket: 'ah',
    kind: 'product',
    url: 'https://www.ah.nl/producten/product/wi1525/fictional-milk',
    capturedAt: '2026-10-15T09:00:00Z',
    sha256: 'a'.repeat(64),
  },
}

for (const route of [
  '/product/fictional-legacy-item',
  '/producten/product/wi1525/fictional-milk',
]) {
  test('AH direct provenance accepts reviewed product route ' + route, () => {
    const observation = {
      ...base,
      provenance: { ...base.provenance, url: 'https://www.ah.nl' + route },
    }
    assert.equal(validateRawProductObservation(observation), observation)
  })
}

for (const route of ['/account/login', '/zoeken?q=melk', '/product/']) {
  test('AH direct provenance rejects non-product route ' + route, () => {
    const observation = {
      ...base,
      provenance: { ...base.provenance, url: 'https://www.ah.nl' + route },
    }
    assert.throws(() => validateRawProductObservation(observation),
      /provenance|product route/)
  })
}
