import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  parsePlusRenderedCatalogEvidence,
  parsePlusRenderedOffersEvidence,
} from '../src/data/plusRenderedListings.ts'
import {
  parseDekaMarktSsrCatalogEvidence,
  parseDekaMarktSsrOffersEvidence,
} from '../src/data/dekaMarktSsrListings.ts'

// Product-owner regression, separate from independent QA #3396. Checked-in
// sanitized archives only: no fetch, rights grant or live pricing.
const cases = [
  ['PLUS catalog', 'plus-rendered-catalog.v1.json', parsePlusRenderedCatalogEvidence],
  ['PLUS offers', 'plus-rendered-offers.v1.json', parsePlusRenderedOffersEvidence],
  ['Deka catalog', 'dekamarkt-catalog-melk.v1.json', parseDekaMarktSsrCatalogEvidence],
  ['Deka offers', 'dekamarkt-offers.v1.json', parseDekaMarktSsrOffersEvidence],
]
const load = async file => JSON.parse(await readFile(
  new URL('../fixtures/m1/' + file, import.meta.url), 'utf8',
))

for (const [name, file, parse] of cases) {
  test(name + ': historical JSON still yields only private archived observations', async () => {
    const source = await load(file)
    const parsed = parse(source)
    assert.equal(parsed.type, 'observations')
    assert.ok(parsed.observations.length > 0)
    for (const item of parsed.observations) {
      assert.equal(item.provenance.url, source.source.url)
      assert.equal(item.provenance.sha256, source.source.sha256)
      assert.equal(item.provenance.capturedAt, source.source.capturedAt)
    }
  })

  test(name + ': caller accessor in source URL refuses without executing', async () => {
    const source = await load(file)
    let invoked = 0
    Object.defineProperty(source.source, 'url', {
      enumerable: true,
      get() { invoked++; throw Error('CALLER_GETTER_URL') },
    })
    let result
    assert.doesNotThrow(() => { result = parse(source) })
    assert.equal(invoked, 0)
    assert.equal(result.type, 'abstain')
    assert.equal(Object.hasOwn(result, 'observations'), false)
  })

  test(name + ': caller accessor in source timestamp refuses without executing', async () => {
    const source = await load(file)
    let invoked = 0
    Object.defineProperty(source.source, 'capturedAt', {
      enumerable: true,
      get() { invoked++; throw Error('CALLER_GETTER_CLOCK') },
    })
    let result
    assert.doesNotThrow(() => { result = parse(source) })
    assert.equal(invoked, 0)
    assert.equal(result.type, 'abstain')
  })

  test(name + ': root payload accessor never executes', async () => {
    const source = await load(file)
    const field = name.startsWith('PLUS') ? 'cards' : 'nuxtPayload'
    let invoked = 0
    Object.defineProperty(source, field, {
      enumerable: true,
      get() { invoked++; throw Error('CALLER_GETTER_ROOT') },
    })
    let result
    assert.doesNotThrow(() => { result = parse(source) })
    assert.equal(invoked, 0)
    assert.equal(result.type, 'abstain')
  })

  test(name + ': nested array/card getters refuse before observation extraction', async () => {
    const source = await load(file)
    let invoked = 0
    if (name.startsWith('PLUS')) {
      Object.defineProperty(source.cards[0], 'href', {
        enumerable: true,
        get() { invoked++; throw Error('CALLER_GETTER_CARD') },
      })
    } else {
      Object.defineProperty(source.nuxtPayload, '0', {
        enumerable: true,
        get() { invoked++; throw Error('CALLER_GETTER_NUXT') },
      })
    }
    let result
    assert.doesNotThrow(() => { result = parse(source) })
    assert.equal(invoked, 0)
    assert.equal(result.type, 'abstain')
  })
}
