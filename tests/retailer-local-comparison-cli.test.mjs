import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareLocalRetailerSnapshots } from '../scripts/retailer-compare-local-snapshots.mjs'

const now=Date.parse('2026-10-15T10:00:00Z')
const html=(price)=>'<script type="application/ld+json">'+JSON.stringify({
  '@type':'Product',sku:'milk-1',name:'Halfvolle melk',
  weight:{value:'1000 ml'},
  offers:{'@type':'Offer',price,priceCurrency:'EUR',
    availability:'https://schema.org/InStock'},
})+'</script>'

test('CLI input pipeline compares offline PLUS and DekaMarkt product HTML end-to-end', async(t)=>{
  const dir=await mkdtemp(join(tmpdir(),'supa-offline-catalog-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  await writeFile(join(dir,'plus.html'),html('1.29'))
  await writeFile(join(dir,'deka.html'),html('1.19'))
  const manifest={
    version:1,
    requirements:[{id:'milk',query:'halfvolle melk',amount:1500,unit:'ml'}],
    snapshots:[
      {sourceId:'plus-product-halfvolle-melk',htmlFile:'plus.html',
        capturedAt:'2026-10-15T09:00:00Z'},
      {sourceId:'dekamarkt-product-halfvolle-melk',htmlFile:'deka.html',
        capturedAt:'2026-10-15T09:30:00Z'},
    ],
  }
  const input=join(dir,'manifest.json')
  await writeFile(input,JSON.stringify(manifest))
  const result=await compareLocalRetailerSnapshots(input,now)
  assert.equal(result.captureSummary.length,2)
  assert.equal(result.captureSummary[0].parsedProducts,1)
  assert.equal(result.captureSummary[1].parsedProducts,1)
  assert.equal(result.comparison.comparable,true)
  assert.equal(result.comparison.claimable,false)
  assert.equal(result.comparison.cheaperStore,'dekamarkt')
  assert.equal(result.comparison.savingsCents,20)
  assert.equal(result.comparison.lines[0].plus.packs,2)
})

test('offline input refuses parent traversal and symlinked snapshots', async(t)=>{
  const dir=await mkdtemp(join(tmpdir(),'supa-offline-invalid-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  const path=join(dir,'manifest.json')
  const manifest={
    version:1,requirements:[{id:'milk',query:'milk',amount:1000,unit:'ml'}],
    snapshots:[
      {sourceId:'plus-product-halfvolle-melk',htmlFile:'../not-allowed.html',capturedAt:'2026-10-15T09:00:00Z'},
      {sourceId:'dekamarkt-product-halfvolle-melk',htmlFile:'deka.html',capturedAt:'2026-10-15T09:00:00Z'},
    ],
  }
  await writeFile(path,JSON.stringify(manifest))
  await assert.rejects(compareLocalRetailerSnapshots(path,now),/reference/)
  await writeFile(join(dir,'actual.html'),html('1.29'))
  await symlink('actual.html',join(dir,'linked.html'))
  await writeFile(join(dir,'deka.html'),html('1.19'))
  manifest.snapshots[0].htmlFile='linked.html'
  await writeFile(path,JSON.stringify(manifest))
  await assert.rejects(compareLocalRetailerSnapshots(path,now),/bounded ordinary file/)
})
