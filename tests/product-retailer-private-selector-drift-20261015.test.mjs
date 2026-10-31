import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, chmod, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { proposeOfflineRetailerSelectors } from '../scripts/retailer-offline-selector-discovery.mjs'
import { compareOfflineSelectorProposals } from '../scripts/retailer-private-selector-drift.mjs'

const whenA='2026-10-03T12:00:00Z'
const whenB='2026-10-04T12:00:00Z'
function proposal(html,time=whenA,retailer='plus'){
  return proposeOfflineRetailerSelectors({html,origin:{
    retailerId:retailer,url:'https://www.'+(retailer==='plus'?'plus.nl':'dekamarkt.nl')+'/producten',
    capturedAt:time,
  }})
}
const original='<article class="product-card"><span class="product-title"></span><p class="price-value"></p></article>'
const modified='<article class="item-card"><span class="product-name"></span><p class="price-value"></p><span class="offer-deal"></span></article>'
const cli=(...args)=>spawnSync(process.execPath,
  [new URL('../scripts/retailer-private-selector-drift.mjs',import.meta.url).pathname,...args],
  {encoding:'utf8',timeout:20000,maxBuffer:2*1024*1024})
async function temp(fn){
  const dir=await mkdtemp(join(tmpdir(),'supa-selector-drift-'))
  try{return await fn(dir)}finally{await rm(dir,{recursive:true,force:true})}
}
test('real offline discovery output tracks semantic candidate additions/removals without selector names',()=>{
  const report=compareOfflineSelectorProposals(proposal(original),proposal(modified,whenB))
  assert.equal(report.mode,'private-offline-selector-drift-alert')
  assert.equal(report.htmlBytesDiffer,true)
  assert.ok(report.newSelectorCandidates>=2)
  assert.ok(report.missingSelectorCandidates>=1)
  assert.ok(report.perField.offer.new>=1)
  assert.equal(report.publicSavingsClaimEligible,false)
  assert.equal(report.automatedSelectorPromotion,false)
  assert.doesNotMatch(JSON.stringify(report),/product-card|item-card|price-value|offer-deal|www\.|https?:|capturedAt|sha256/)
})
test('same HTML bytes with later immutable capture changes NO selector signals',()=>{
  const report=compareOfflineSelectorProposals(proposal(original),proposal(original,whenB))
  assert.equal(report.htmlBytesDiffer,false)
  assert.equal(report.newSelectorCandidates,0)
  assert.equal(report.missingSelectorCandidates,0)
  assert.equal(report.structuredSignalFlips,0)
})
test('HTML body can change while selector proposals remain identical',()=>{
  const variant=original.replace('<span','<span data-unimportant="yes"')
  const report=compareOfflineSelectorProposals(proposal(original),proposal(variant,whenB))
  assert.equal(report.htmlBytesDiffer,true)
  assert.equal(report.newSelectorCandidates,0)
  assert.equal(report.missingSelectorCandidates,0)
})
test('Schema.org/JSONLD signal changes remain manual proposals, never valid price evidence',()=>{
  const withJsonLd=original+'<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product"}</script>'
  const report=compareOfflineSelectorProposals(proposal(original),proposal(withJsonLd,whenB))
  assert.equal(report.structuredSignalFlips,2)
  assert.equal(report.permissionVerified,false)
  assert.equal(report.productionEnabled,false)
})
test('rewriting selectors for an identical immutable SHA is refused',()=>{
  const a=proposal(original),b=structuredClone(a)
  b.selectors[0].selector='article.fake-product'
  assert.throws(()=>compareOfflineSelectorProposals(a,b),/refused/)
})
test('another store, future capture, backwards chronology and forged rights all refuse',()=>{
  const a=proposal(original),normal=proposal(modified,whenB)
  for(const b of [
    proposal(modified,whenB,'dekamarkt'),
    {...normal,source:{...normal.source,capturedAt:'2035-01-01T00:00:00Z'}},
    proposal(modified,'2026-10-02T12:00:00Z'),
    {...normal,permissionVerified:true},
    {...normal,publicSavingsClaimEligible:true},
  ])assert.throws(()=>compareOfflineSelectorProposals(a,b),/refused/)
})
test('real 0600 offline proposal files feed privacy-safe executable CLI',()=>temp(async dir=>{
  const a=join(dir,'before.json'),b=join(dir,'after.json')
  await writeFile(a,JSON.stringify(proposal(original)),{mode:0o600})
  await writeFile(b,JSON.stringify(proposal(modified,whenB)),{mode:0o600})
  const result=cli('--before',a,'--after',b)
  assert.equal(result.status,0,result.stderr)
  const report=JSON.parse(result.stdout)
  assert.ok(report.newSelectorCandidates>0)
  assert.equal(report.externalRequests,0)
  assert.doesNotMatch(result.stdout,/product-card|price-value|https?:|sha256|capturedAt/)
}))
test('CLI refuses world-readable files and aliased source without leaking path',()=>temp(async dir=>{
  const a=join(dir,'before.json'),b=join(dir,'after.json')
  await writeFile(a,JSON.stringify(proposal(original)),{mode:0o600})
  await writeFile(b,JSON.stringify(proposal(modified,whenB)),{mode:0o600})
  await chmod(a,0o644)
  let result=cli('--before',a,'--after',b)
  assert.notEqual(result.status,0)
  assert.equal(result.stdout,'')
  await chmod(a,0o600)
  const alias=join(dir,'alias.json')
  await symlink(a,alias)
  result=cli('--before',alias,'--after',b)
  assert.notEqual(result.status,0)
  assert.equal(result.stdout,'')
  assert.doesNotMatch(result.stderr,/\/tmp\/|before\.json|after\.json/)
}))

test('offline drift recognizes genuine Product/Thing multi-type changes without exposing raw itemtype or promoting sources',()=>{
  for(const retailerId of ['plus','dekamarkt']){
    const older=proposal('<section itemscope itemtype="https://schema.org/Product"></section>',whenA,retailerId)
    const newer=proposal('<section itemscope itemtype="https://schema.org/Product https://schema.org/Thing"></section>',whenB,retailerId)
    const alert=compareOfflineSelectorProposals(older,newer)
    assert.equal(alert.perField.product.new,1,retailerId)
    assert.equal(alert.perField.product.missing,1,retailerId)
    assert.equal(alert.reviewRequired,true)
    assert.equal(alert.automatedSelectorPromotion,false)
    assert.equal(alert.productionEnabled,false)
    assert.doesNotMatch(JSON.stringify(alert),/schema\.org|Product|Thing|https?:/)
  }
})

test('PLUS/Deka six-field real source-observed data-test/data-qa drift comparison stays privacy-safe',()=>{
  for (const retailer of ['plus','dekamarkt']) {
    const first=['product_card','product_name','price_value','pack_size','offer_label','stock_availability']
    const fields=['article','h2','span','span','strong','span']
    const older='<main>'+first.map((token,i)=>`<${fields[i]} data-test="${token}" data-qa="${token}">SYNTHETIC</${fields[i]}>`).join('')+'</main>'
    const newer=older.replace('data-test="price_value"','data-test="price-label"')
    const oldReport=proposal(older,whenA,retailer)
    const newReport=proposal(newer,whenB,retailer)
    assert.ok(oldReport.selectors.some(s=>s.field==='price'&&s.selector==='span[data-test="price_value"]'))
    const alert=compareOfflineSelectorProposals(oldReport,newReport)
    assert.equal(alert.perField.price.new,1)
    assert.equal(alert.perField.price.missing,1)
    assert.equal(alert.automatedSelectorPromotion,false)
    assert.equal(alert.productionEnabled,false)
    assert.doesNotMatch(JSON.stringify(alert),/data-qa|data-test|price_value|price-label|SYNTHETIC/)
  }
})
test('offline drift accepts valid nine-digit UTC capture precision without inventing a selector',()=>{
  const first=proposal(original,'2026-10-03T12:00:00.123456788Z')
  const second=proposal(original,'2026-10-03T12:00:00.123456789Z')
  const result=compareOfflineSelectorProposals(first,second)
  assert.equal(result.newSelectorCandidates,0)
  assert.equal(result.htmlBytesDiffer,false)
  assert.throws(()=>compareOfflineSelectorProposals(second,first),/refused/)
  for(const bad of ['2026-02-30T10:00:00.123456789Z','2026-10-03T12:00:00.1234567890Z']) {
    const altered=proposal(original,whenB)
    altered.source.capturedAt=bad
    assert.throws(()=>compareOfflineSelectorProposals(first,altered),/refused/)
  }
})

test('full private two-store 0600 archive drift accepts nine-digit observed data-test/data-qa and exports only aggregates',()=>temp(async dir=>{
  for(const retailer of ['plus','dekamarkt']) {
    const initial='<article data-test="product_card"><span data-qa="price_value">SECRET_STORED_PRICE_123</span></article>'
    const updated='<article data-test="product_card"><span data-qa="price-label">SECRET_STORED_PRICE_456</span></article>'
    const older=proposal(initial,'2026-10-03T12:00:00.123456788Z',retailer)
    const newer=proposal(updated,'2026-10-03T12:00:00.123456789Z',retailer)
    const beforeFile=join(dir,retailer+'-before.json'),afterFile=join(dir,retailer+'-after.json')
    await writeFile(beforeFile,JSON.stringify(older),{mode:0o600})
    await writeFile(afterFile,JSON.stringify(newer),{mode:0o600})
    const process=cli('--before',beforeFile,'--after',afterFile)
    assert.equal(process.status,0,process.stderr)
    const report=JSON.parse(process.stdout)
    assert.equal(report.perField.price.new,1)
    assert.equal(report.perField.price.missing,1)
    assert.equal(report.automatedSelectorPromotion,false)
    assert.equal(report.externalRequests,0)
    assert.doesNotMatch(process.stdout+process.stderr,/SECRET_STORED_PRICE|product_card|price_value|price-label|data-qa|data-test|sha256|capturedAt/)
  }
}))
