import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareLocalRetailerSnapshots, main } from '../scripts/retailer-compare-local-snapshots.mjs'

/** Independent REAL offline-file pipeline replay; zero network activity.
 * All shop product JSON-LD and prices below are constructed fiction.
 * Two deliberately RED assertions cover direct catalog trust issues
 * independently of the in-memory contract tests in sibling QA file.
 */
const NOW=Date.parse('2026-10-15T10:00:00.000Z')
const sku='fictional-milk-1'
const script=(availability,price)=>'<script type="application/ld+json">'+
  JSON.stringify({
    '@type':'Product',sku,name:'Halfvolle melk',
    weight:{value:'1000 ml'},
    offers:{'@type':'Offer',price,priceCurrency:'EUR',
      availability:'https://schema.org/'+availability},
  })+'</script>'

async function fixture(t, opts={}) {
  const dir=await mkdtemp(join(tmpdir(),'supa-qa-catalog-integrity-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  const manifest={
    version:1,
    requirements:[{id:'milk',query:'halfvolle melk',amount:1500,unit:'ml'}],
    snapshots:[
      {sourceId:'plus-product-halfvolle-melk',htmlFile:'plus.html',
        capturedAt:opts.plusAt??'2026-10-15T09:00:00.000Z'},
      {sourceId:'dekamarkt-product-halfvolle-melk',htmlFile:'deka.html',
        capturedAt:opts.dekaAt??'2026-10-15T09:30:00.000Z'},
    ],
  }
  const manifestFile=join(dir,'manifest.json')
  const plusFile=join(dir,'plus.html')
  const dekaFile=join(dir,'deka.html')
  await writeFile(plusFile,opts.plusHtml??script('InStock','1.29'))
  await writeFile(dekaFile,opts.dekaHtml??script('InStock','1.19'))
  await writeFile(manifestFile,JSON.stringify(manifest))
  return {dir,manifest,manifestFile,plusFile,dekaFile}
}

function mustNotChooseWinner(result) {
  assert.equal(result.warning.includes('not a live retailer price'),true)
  assert.equal(result.comparison.claimable,false)
  assert.equal(result.comparison.comparable,false)
  assert.equal(result.comparison.cheaperStore,null)
  assert.equal(result.comparison.savingsCents,null)
}

test('real file pipeline keeps 1.5-liter package math and source manifests unchanged',async t=>{
  const f=await fixture(t)
  const original=await readFile(f.manifestFile)
  const result=await compareLocalRetailerSnapshots(f.manifestFile,NOW)
  assert.deepEqual(result.captureSummary.map(r=>r.parsedProducts),[1,1])
  assert.equal(result.comparison.provenance,'offline-snapshot-preview')
  assert.equal(result.comparison.claimable,false)
  assert.equal(result.comparison.comparable,true)
  assert.equal(result.comparison.lines[0].plus.totalCents,258)
  assert.equal(result.comparison.lines[0].dekamarkt.totalCents,238)
  assert.equal(result.comparison.lines[0].differenceCents,-20)
  assert.equal(result.comparison.savingsCents,20)
  assert.deepEqual(await readFile(f.manifestFile),original)
})

test('real CLI only creates a private report, and does not overwrite an existing report',async t=>{
  const f=await fixture(t)
  const output=join(f.dir,'report.json')
  const originalLog=console.log
  const log=[]
  console.log=(message)=>log.push(String(message))
  try {
    await main([f.manifestFile,'--out',output])
    assert.equal(log.join('\n').includes('Halfvolle melk'),false)
    assert.equal((await stat(output)).mode & 0o777,0o600)
    const bytes=await readFile(output,'utf8')
    assert.equal(JSON.parse(bytes).comparison.claimable,false)
    await assert.rejects(main([f.manifestFile,'--out',output]),/EEXIST/)
    assert.equal(await readFile(output,'utf8'),bytes)
  } finally {
    console.log=originalLog
  }
})

test('EXPECTED RED: stock-state collision within PLUS product HTML cannot create winner',async t=>{
  const f=await fixture(t,{
    plusHtml:script('InStock','1.29')+script('OutOfStock','1.29'),
  })
  const result=await compareLocalRetailerSnapshots(f.manifestFile,NOW)
  assert.equal(result.captureSummary[0].parsedProducts,2,
    'both observations were extracted from the actual input HTML')
  mustNotChooseWinner(result)
})

test('EXPECTED RED: actual HTML manifest future 1ns timestamp is not equivalent to now',async t=>{
  const f=await fixture(t,{
    dekaAt:'2026-10-15T10:00:00.000000001Z',
  })
  const result=await compareLocalRetailerSnapshots(f.manifestFile,NOW)
  assert.equal(result.captureSummary[1].parsedProducts,1)
  mustNotChooseWinner(result)
})

test('real file pipeline refuses malformed price/pack rather than inventing winner',async t=>{
  const f=await fixture(t,{
    dekaHtml:script('InStock','not-money'),
  })
  const result=await compareLocalRetailerSnapshots(f.manifestFile,NOW)
  mustNotChooseWinner(result)
  assert.equal(result.comparison.lines[0].dekamarkt.totalCents,null)
})
