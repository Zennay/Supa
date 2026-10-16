import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  parsePlusRenderedCatalogEvidence,
  parsePlusRenderedOffersEvidence,
} from '../src/data/plusRenderedListings.ts'

// Independent QA reuses previously checked-in, SANITIZED 2026-10-04 M1
// browser-evidence structures. No new PLUS request or permission is made.
// Only mutate public-like provenance fields of private local fixture copies.
const fixtures = [
  ['catalog','plus-rendered-catalog.v1.json',parsePlusRenderedCatalogEvidence],
  ['offers','plus-rendered-offers.v1.json',parsePlusRenderedOffersEvidence],
]
const archive = async filename => JSON.parse(await readFile(
  new URL('../fixtures/m1/' + filename, import.meta.url),'utf8',
))

for (const [kind,filename,parse] of fixtures) {
  test('PLUS '+kind+' historical sanitized baseline remains private parse-only evidence',async()=>{
    const original=await archive(filename)
    const result=parse(original)
    assert.equal(result.type,'observations')
    assert.ok(result.observations.length>=1)
    for(const row of result.observations){
      assert.equal(row.provenance.url,original.source.url)
      assert.equal(row.provenance.sha256,original.source.sha256)
      assert.equal(row.provenance.capturedAt,original.source.capturedAt)
    }
  })

  test('PLUS '+kind+' cannot treat an impossible FUTURE browser capture as historical price proof',async()=>{
    const changed=await archive(filename)
    changed.source.capturedAt='2099-10-04T18:53:02.645Z'
    // Browser metadata still matches the original rendered SHA; it is the
    // false capture-time claim that must independently fail closed.
    const result=parse(changed)
    assert.equal(result.type,'abstain')
    assert.equal(Object.hasOwn(result,'observations'),false)
  })

  for(const suffix of [
    '?access_token=fictional_not_a_secret',
    '?refresh_token=fictional_not_a_secret',
    '#unverified-product-anchor',
  ]) {
    test('PLUS '+kind+' may not put unreviewed query/fragment source identity in an observation: '+suffix,async()=>{
      const changed=await archive(filename)
      changed.source.url+=suffix
      const result=parse(changed)
      assert.equal(result.type,'abstain')
      assert.equal(Object.hasOwn(result,'observations'),false)
    })
  }
}
