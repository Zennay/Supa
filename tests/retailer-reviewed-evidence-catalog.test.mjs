import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  parseRetailerCatalogEvidence, compareReviewedRetailerEvidence,
} from '../src/data/reviewedRetailerEvidence.ts'

const load=(name)=>readFile(new URL('../fixtures/m1/'+name,import.meta.url),'utf8').then(JSON.parse)
const req=[{id:'milk',query:'halfvolle melk',amount:1000,unit:'ml'}]

test('original PLUS browser and DekaMarkt Nuxt catalog adapters feed one comparison engine',async()=>{
  const [plus,deka]=await Promise.all([
    load('plus-rendered-catalog.v1.json'),load('dekamarkt-catalog-melk.v1.json'),
  ])
  const parsedPlus=parseRetailerCatalogEvidence(plus)
  const parsedDeka=parseRetailerCatalogEvidence(deka)
  assert.equal(parsedPlus.type,'observations')
  assert.equal(parsedDeka.type,'observations')
  assert.equal(parsedPlus.observations.length,4)
  assert.equal(parsedDeka.observations.length,3)
  const result=compareReviewedRetailerEvidence({
    requirements:req,evidence:[plus,deka],
    nowMs:Date.parse('2026-10-04T19:00:00Z'),
  })
  assert.equal(result.parsedProducts,7)
  assert.equal(result.provenance,'reviewed-local-evidence')
  assert.equal(result.claimable,false)
  assert.equal(result.comparison.claimable,false)
  assert.equal(result.comparison.lines.length,1)
  assert.equal(result.comparison.lines[0].ingredientId,'milk')
  // Even observed price listings lack positive stock assurance; abstain
  // from a complete basket-winner claim rather than invent availability.
  assert.equal(result.comparison.comparable,false)
})

test('bad source evidence and identical cohort kinds fail closed',async()=>{
  const [plus,deka]=await Promise.all([
    load('plus-rendered-catalog.v1.json'),load('dekamarkt-catalog-melk.v1.json'),
  ])
  assert.equal(parseRetailerCatalogEvidence({evidenceType:'unknown'}).type,'abstain')
  await assert.rejects(async()=>compareReviewedRetailerEvidence({
    requirements:req,evidence:[plus,{...deka,evidenceType:'wrong'}],
    nowMs:Date.parse('2026-10-04T19:00:00Z'),
  }),/Untrusted/)
  assert.throws(()=>compareReviewedRetailerEvidence({
    requirements:req,evidence:[plus,plus,deka],
    nowMs:Date.parse('2026-10-04T19:00:00Z'),
  }),/Duplicate/)
})

test('reviewed October fixture is not a current October 15th quote',async()=>{
  const [plus,deka]=await Promise.all([
    load('plus-rendered-catalog.v1.json'),load('dekamarkt-catalog-melk.v1.json'),
  ])
  const result=compareReviewedRetailerEvidence({
    requirements:req,evidence:[plus,deka],
    nowMs:Date.parse('2026-10-15T10:00:00Z'),
  })
  assert.equal(result.comparison.comparable,false)
  assert.equal(result.comparison.reason,'invalid_or_stale_source')
  assert.equal(result.comparison.cheaperStore,null)
})
