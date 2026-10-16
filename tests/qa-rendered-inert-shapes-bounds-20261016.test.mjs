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

// Independent QA of inert-data shape limits beyond the owner's own URL,
// clock, root-array, and card getter coverage. Uses only committed SANITIZED
// historical fixtures; no retailer network, source grants, or current prices.
const cases = [
  ['PLUS catalog', 'plus-rendered-catalog.v1.json', parsePlusRenderedCatalogEvidence],
  ['PLUS offers', 'plus-rendered-offers.v1.json', parsePlusRenderedOffersEvidence],
  ['Deka catalog', 'dekamarkt-catalog-melk.v1.json', parseDekaMarktSsrCatalogEvidence],
  ['Deka offers', 'dekamarkt-offers.v1.json', parseDekaMarktSsrOffersEvidence],
]
const load = async file => JSON.parse(await readFile(
  new URL('../fixtures/m1/' + file, import.meta.url), 'utf8',
))
const expectAbstain = (parse, source, label) => {
  let result
  assert.doesNotThrow(() => { result = parse(source) }, label)
  assert.equal(result?.type, 'abstain', label)
  assert.equal(Object.hasOwn(result, 'observations'), false, label)
}

for (const [name, file, parse] of cases) {
  test(name + ': original reviewed historical JSON still parses', async () => {
    const source = await load(file)
    const result = parse(source)
    assert.equal(result.type, 'observations')
    assert.ok(result.observations.length > 0)
    assert.ok(result.observations.every(row =>
      row.provenance.sha256 === source.source.sha256 &&
      row.provenance.url === source.source.url))
  })

  test(name + ': extra source getter is never invoked, even if parser does not use its key', async () => {
    const source = await load(file)
    let calls = 0
    Object.defineProperty(source.source, 'qaUnexpectedExecutableField', {
      enumerable: true, configurable: true,
      get() { calls++; throw Error('UNREVIEWED_EXTRA_SOURCE_ACCESSOR') },
    })
    expectAbstain(parse, source, name + ': unexpected getter')
    assert.equal(calls, 0)
  })

  test(name + ': inherited custom source prototype is not reviewed JSON', async () => {
    const source = await load(file)
    let calls = 0
    const foreign = Object.create(null)
    Object.defineProperty(foreign, 'qaInheritedTrap', {
      enumerable: true,
      get() { calls++; throw Error('INHERITED_TRAP') },
    })
    Object.setPrototypeOf(source.source, foreign)
    expectAbstain(parse, source, name + ': prototype')
    assert.equal(calls, 0)
  })

  test(name + ': unreviewed symbol metadata is not an inert JSON source', async () => {
    const source = await load(file)
    source.source[Symbol('qa-invisible-source-metadata')] = 'not-from-json'
    expectAbstain(parse, source, name + ': symbol')
  })

  test(name + ': sparse archive evidence arrays are refused before any price observation', async () => {
    const source = await load(file)
    const arr = name.startsWith('PLUS') ? source.cards : source.nuxtPayload
    assert.ok(Array.isArray(arr) && arr.length > 0)
    delete arr[0]
    expectAbstain(parse, source, name + ': sparse')
  })

  test(name + ': cyclic in-process archive cannot be used as historical evidence', async () => {
    const source = await load(file)
    source.qaCircular = source
    expectAbstain(parse, source, name + ': cyclic')
  })

  test(name + ': oversized irrelevant string is not accepted as a bounded source', async () => {
    const source = await load(file)
    source.source.qaOversize = 'x'.repeat(100_001)
    expectAbstain(parse, source, name + ': bounded string')
  })
}
