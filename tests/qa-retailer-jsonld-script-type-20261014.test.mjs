import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { compareLocalRetailerSnapshots } from '../scripts/retailer-compare-local-snapshots.mjs'

/** Provenance of HTML Script[type] is different from misleading data-type:
 * every document below is synthetic and never retrieved from retailers. */
const TODAY='2026-10-15T09:00:00.000Z'
const nowMs=Date.parse('2026-10-15T10:00:00.000Z')
const encodedProduct=JSON.stringify({
  '@context':'https://schema.org',
  '@type':'Product',
  sku:'fictional-milk',
  name:'Halfvolle melk',
  weight:{value:'1000 ml'},
  offers:{
    '@type':'Offer',price:'1.29',priceCurrency:'EUR',
    availability:'https://schema.org/InStock',
  },
})
const html=(attr)=>`<!doctype html><script ${attr}>${encodedProduct}</script>`
const sourcePlus=SOURCES.find(s=>s.id==='plus-product-halfvolle-melk')
const sourceDeka=SOURCES.find(s=>s.id==='dekamarkt-product-halfvolle-melk')

test('real JSON-LD typed script parses one offline Product only with correct source metadata',()=>{
  const observed=parseOfflineRetailerSnapshot({
    source:sourcePlus,html:html('type="application/ld+json"'),capturedAt:TODAY,
  })
  assert.equal(observed.scriptsInspected,1)
  assert.equal(observed.rejected,0)
  assert.equal(observed.observations.length,1)
  assert.equal(observed.observations[0].currentPriceCents,129)
  assert.equal(observed.observations[0].provenance.url,sourcePlus.url)
})

test('EXPECTED RED: data-type or namespaced fake attributes must NOT be interpreted as Script[type]',()=>{
  for (const pretendType of ['data-type', 'x-type', 'not-type']) {
    const observed=parseOfflineRetailerSnapshot({
      source:sourcePlus,html:html(`${pretendType}="application/ld+json"`),
      capturedAt:TODAY,
    })
    assert.equal(observed.scriptsInspected,0,
      `${pretendType} is not a JSON-LD script type; cannot count as source evidence`)
    assert.equal(observed.observations.length,0)
  }
})

test('EXPECTED RED: both shops with only data-type scripts must never produce a comparable basket',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'supa-qa-untyped-jsonld-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  await writeFile(join(dir,'plus.html'),html('data-type="application/ld+json"'))
  await writeFile(join(dir,'deka.html'),html('data-type="application/ld+json"'))
  const manifest={
    version:1,
    requirements:[{id:'milk',query:'halfvolle melk',amount:1500,unit:'ml'}],
    snapshots:[
      {sourceId:sourcePlus.id,htmlFile:'plus.html',capturedAt:TODAY},
      {sourceId:sourceDeka.id,htmlFile:'deka.html',capturedAt:TODAY},
    ],
  }
  const manifestPath=join(dir,'manifest.json')
  await writeFile(manifestPath,JSON.stringify(manifest))
  const result=await compareLocalRetailerSnapshots(manifestPath,nowMs)
  assert.deepEqual(result.captureSummary.map(x=>x.parsedProducts),[0,0])
  assert.equal(result.comparison.provenance,'offline-snapshot-preview')
  assert.equal(result.comparison.claimable,false)
  assert.equal(result.comparison.comparable,false)
  assert.equal(result.comparison.cheaperStore,null)
  assert.equal(result.comparison.savingsCents,null)
})

test('EXPECTED RED: HTML comments containing apparent JSON-LD must never become retailer price evidence', () => {
  const commented = `<!-- ${html('type="application/ld+json"')} -->`
  const parsed = parseOfflineRetailerSnapshot({
    source: sourcePlus, html: commented, capturedAt: TODAY,
  })
  assert.equal(parsed.scriptsInspected, 0,
    'HTML comments contain no actual script elements')
  assert.equal(parsed.observations.length, 0)
})
