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

// This test exercises DIRECT exported parser entry points, not orchestrator
// wrappers which may independently sanitize descriptors. A caller supplied
// JavaScript accessor is not a reviewed, inert JSON archive. It must be
// rejected without *executing* caller code or throwing the getter's value.
// No network, secrets, or real retailer observations are collected.
const fixtures = [
  ['PLUS catalog', 'plus-rendered-catalog.v1.json', parsePlusRenderedCatalogEvidence, 'source', 'url'],
  ['PLUS offers', 'plus-rendered-offers.v1.json', parsePlusRenderedOffersEvidence, 'root', 'cards'],
  ['Deka catalog', 'dekamarkt-catalog-melk.v1.json', parseDekaMarktSsrCatalogEvidence, 'source', 'capturedAt'],
  ['Deka offers', 'dekamarkt-offers.v1.json', parseDekaMarktSsrOffersEvidence, 'root', 'nuxtPayload'],
]
const load = async file => JSON.parse(await readFile(
  new URL('../fixtures/m1/' + file, import.meta.url), 'utf8',
))

for (const [name, file, parse, at, field] of fixtures) {
  test(name + ' ordinary historical JSON remains accepted', async () => {
    const data = await load(file)
    const result = parse(data)
    assert.equal(result.type, 'observations')
    assert.ok(result.observations.length > 0)
  })

  test(name + ' must not execute in-process getter for ' + at + '.' + field, async () => {
    const data = await load(file)
    const target = at === 'source' ? data.source : data
    let executions = 0
    Object.defineProperty(target, field, {
      enumerable: true,
      configurable: true,
      get() {
        executions += 1
        throw Error('UNTRUSTED_RENDERED_ARCHIVE_GETTER_MUST_NOT_EXECUTE')
      },
    })
    let result
    assert.doesNotThrow(() => { result = parse(data) },
      name + ' should fail closed on non-inert source descriptors')
    assert.equal(executions, 0, name + ' accessed caller executable property')
    assert.equal(result?.type, 'abstain')
    assert.equal(Object.hasOwn(result, 'observations'), false)
  })
}
