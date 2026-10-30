import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtemp,writeFile,readFile,stat,rm,link,unlink,symlink,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {buildPrivateSyntheticHtmlFixture,verifyPrivateSyntheticHtmlFixture,buildPrivateSyntheticFixturePair,verifyPrivateSyntheticFixturePair} from '../scripts/retailer-private-structural-fixture.mjs'
import {replayPrivateProductHtmlSnapshot,replayPrivateSelectorHtmlSnapshot} from '../scripts/retailer-replay-private-html-product.mjs'
import {proposeOfflineRetailerSelectors,summarizeOfflineSelectorProposals} from '../scripts/retailer-offline-selector-discovery.mjs'

const digest=x=>createHash('sha256').update(x).digest('hex')
async function archive(t,retailerId,kind,customHtml=null) {
  const dir=await mkdtemp(join(tmpdir(),'supa-structural-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  const root=retailerId==='plus'?'/product/':'/producten/'
  const srcUrl='https://www.'+(retailerId==='plus'?'plus':'dekamarkt')+
    '.nl/'+(kind==='product'?root.slice(1)+'synthetic-321':
      kind==='catalog'?'producten':'aanbiedingen')
  const html=customHtml??('<html><head><meta charset="UTF-8"></head><body>'+
    '<article class="product-card"><span class="product-name">PRIVATE_SECRET_123</span>'+
    '<span class="price-label">€999,99</span><a href="'+root+
    'private-sku-secret">PRIVATE PRODUCT NAME</a></article></body></html>')
  const filename=join(dir,'original.html')
  const capture={schemaVersion:1,recordType:'one-page-private-html-capture',
    status:'private-review-required',
    source:{retailerId,kind,url:srcUrl,capturedAt:'2026-10-14T12:00:00.000Z',
      sha256:digest(html)},bytes:Buffer.byteLength(html),
    selectorReviewComplete:false,releaseReady:false,
    publicSavingsClaimEligible:false}
  await writeFile(filename,html,{mode:0o600})
  await writeFile(filename+'.manifest.json',
    JSON.stringify(capture,null,2)+'\n',{mode:0o600})
  return {filename,dir,html,capture}
}

for(const [retailer,kind] of [
  ['plus','catalog'],['dekamarkt','offers'],['plus','product']
]) {
  test('private '+retailer+' '+kind+' archive generates only synthetic HTML',async t=>{
    const {filename,dir,html,capture}=await archive(t,retailer,kind)
    const output=join(dir,'sanitized')
    const result=await buildPrivateSyntheticHtmlFixture(filename,output)
    assert.equal(result.created,true)
    assert.ok(result.syntheticNodes>=1)
    assert.equal(result.productionEnabled,false)
    assert.equal(result.published,false)
    const transformed=await readFile(join(output,'synthetic-structure.html'),'utf8')
    const manifest=JSON.parse(await readFile(join(output,'provenance.json'),'utf8'))
    assert.match(transformed,/SYNTHETIC STRUCTURE - NOT RETAILER HTML/)
    assert.match(transformed,/data-synthetic="true"/)
    assert.doesNotMatch(transformed,/PRIVATE_SECRET_123|€999|private-sku-secret|PRIVATE PRODUCT NAME/)
    assert.doesNotMatch(transformed,/www\.plus\.nl|www\.dekamarkt\.nl/)
    assert.notEqual(transformed,html)
    const inputReview=kind==='product'
      ?(await replayPrivateProductHtmlSnapshot(filename)).selectorSnapshot
      :(await replayPrivateSelectorHtmlSnapshot(filename)).proposals
    const expected=summarizeOfflineSelectorProposals(inputReview).selectors.filter(row=>
      /^(?:article|section|div|span|p|li|h[1-6]|a)\.[a-z][a-z0-9_-]+$/i.test(row.selector) ||
      /^a\[href\^="\/(?:product|producten)\/"\]$/.test(row.selector))
    const roundtrip=proposeOfflineRetailerSelectors({html:transformed,
      origin:{retailerId:retailer,url:capture.source.url,capturedAt:capture.source.capturedAt}})
    const recreated=new Set(roundtrip.selectors.map(row=>row.field+'|'+row.selector))
    assert.ok(expected.length>0)
    for(const row of expected) {
      assert.ok(recreated.has(row.field+'|'+row.selector),
        'synthetic HTML must remain parseable for observed source selector: '+row.selector)
    }
    assert.equal(roundtrip.readyForIngestion,false)
    assert.equal(manifest.syntheticSelectorRoundtripVerified,true)
    assert.equal(manifest.source.sha256,capture.source.sha256)
    assert.equal(manifest.source.kind,kind)
    assert.equal(manifest.syntheticHtmlSha256,digest(transformed))
    assert.equal(manifest.originalHtmlRetained,false)
    assert.equal(manifest.sourcePricesRetained,false)
    assert.equal(manifest.productionEnabled,false)
    assert.equal((await stat(output)).mode&0o777,0o700)
    assert.equal((await stat(join(output,'synthetic-structure.html'))).mode&0o777,0o600)
    assert.equal((await stat(join(output,'provenance.json'))).mode&0o777,0o600)
    assert.deepEqual((await readdir(dir)).filter(n=>n.startsWith('.supa-synthetic-fixture-')),[])
    await assert.rejects(buildPrivateSyntheticHtmlFixture(filename,output),/EEXIST/)
    assert.deepEqual((await readdir(dir)).filter(n=>n.startsWith('.supa-synthetic-fixture-')),[])
  })
}

test('tampered snapshot never creates a structural fixture',async t=>{
  const {filename,dir}=await archive(t,'plus','catalog')
  await writeFile(filename,'<p>SYNTHETIC CHANGED</p>',{mode:0o600})
  const output=join(dir,'forbidden')
  await assert.rejects(buildPrivateSyntheticHtmlFixture(filename,output))
  await assert.rejects(stat(output),{code:'ENOENT'})
})

test('operator CLI returns only non-sensitive fixture receipt',async t=>{
  const {spawnSync}=await import('node:child_process')
  const {filename,dir}=await archive(t,'dekamarkt','offers')
  const output=join(dir,'cli-private')
  const command=['--experimental-strip-types',
    new URL('../scripts/retailer-private-structural-fixture.mjs',import.meta.url).pathname,
    filename,output]
  const child=spawnSync(process.execPath,command,{encoding:'utf8',timeout:10000})
  assert.equal(child.status,0,child.stderr)
  assert.equal(JSON.parse(child.stdout).created,true)
  assert.doesNotMatch(child.stdout+child.stderr,
    /PRIVATE_SECRET_123|€999|private-sku-secret|PRIVATE PRODUCT NAME|www\.dekamarkt\.nl/)
  assert.equal((await stat(join(output,'provenance.json'))).mode&0o777,0o600)
})

for (const [retailer,kind] of [
  ['plus','product'],['plus','catalog'],['dekamarkt','offers']
]) {
  test('SHA-bound synthetic output verifies against original '+retailer+' '+kind+' source',async t=>{
    const {filename,dir}=await archive(t,retailer,kind)
    const output=join(dir,'validated')
    await buildPrivateSyntheticHtmlFixture(filename,output)
    const verdict=await verifyPrivateSyntheticHtmlFixture(filename,output)
    assert.equal(verdict.verified,true)
    assert.equal(verdict.published,false)
    assert.equal(verdict.productionEnabled,false)
    assert.equal(typeof verdict.htmlSha256,'string')
    const wrongSource=await archive(t,retailer==='plus'?'dekamarkt':'plus',retailer==='plus'?'offers':'catalog')
    await assert.rejects(
      verifyPrivateSyntheticHtmlFixture(wrongSource.filename,output),
      /Private synthetic structural fixture refused/)
    assert.equal((await verifyPrivateSyntheticHtmlFixture(filename,output)).verified,true)
  })
}

test('tampering derived HTML and manifest is caught even if manifest hash is recomputed',async t=>{
  const {filename,dir}=await archive(t,'plus','catalog')
  const output=join(dir,'sealed')
  const htmlFile=join(output,'synthetic-structure.html')
  const metadataFile=join(output,'provenance.json')
  await buildPrivateSyntheticHtmlFixture(filename,output)
  const originalHtml=await readFile(htmlFile)
  const originalManifest=await readFile(metadataFile)
  await writeFile(htmlFile,Buffer.concat([originalHtml,Buffer.from('CHANGED')]))
  await assert.rejects(verifyPrivateSyntheticHtmlFixture(filename,output))
  await writeFile(htmlFile,originalHtml)
  const forged=JSON.parse(originalManifest)
  forged.syntheticNodes=999
  forged.syntheticHtmlSha256=digest(originalHtml)
  await writeFile(metadataFile,JSON.stringify(forged))
  await assert.rejects(verifyPrivateSyntheticHtmlFixture(filename,output))
  await writeFile(metadataFile,originalManifest)
  const duplicate=originalManifest.toString('utf8').replace('"published": false',
    '"published": false, "published": true')
  await writeFile(metadataFile,duplicate)
  await assert.rejects(verifyPrivateSyntheticHtmlFixture(filename,output))
  await writeFile(metadataFile,originalManifest)
  assert.equal((await verifyPrivateSyntheticHtmlFixture(filename,output)).verified,true)
})

test('derived fixture verifier fails closed on file aliases',async t=>{
  const {filename,dir}=await archive(t,'dekamarkt','offers')
  const output=join(dir,'sealed')
  await buildPrivateSyntheticHtmlFixture(filename,output)
  const htmlFile=join(output,'synthetic-structure.html')
  const alias=join(dir,'html-hardlink')
  await link(htmlFile,alias)
  await assert.rejects(verifyPrivateSyntheticHtmlFixture(filename,output))
  await unlink(alias)
  await rm(htmlFile)
  await symlink(join(dir,'original.html'),htmlFile)
  await assert.rejects(verifyPrivateSyntheticHtmlFixture(filename,output))
})

test('operator verification CLI reports reproducible digest without raw retailer details',async t=>{
  const {spawnSync}=await import('node:child_process')
  const {filename,dir}=await archive(t,'plus','catalog')
  const output=join(dir,'verify-cli')
  await buildPrivateSyntheticHtmlFixture(filename,output)
  const argv=['--experimental-strip-types',
    new URL('../scripts/retailer-private-structural-fixture.mjs',import.meta.url).pathname,
    '--verify',filename,output]
  const child=spawnSync(process.execPath,argv,{encoding:'utf8',timeout:10000})
  assert.equal(child.status,0,child.stderr)
  const receipt=JSON.parse(child.stdout)
  assert.equal(receipt.verified,true)
  assert.equal(receipt.published,false)
  assert.equal(receipt.productionEnabled,false)
  assert.equal(receipt.htmlSha256.length,64)
  assert.doesNotMatch(child.stdout+child.stderr,
    /PRIVATE_SECRET_123|€999|private-sku-secret|PRIVATE PRODUCT NAME|www\.plus\.nl/)
  const meta=join(output,'provenance.json')
  const forged=(await readFile(meta,'utf8')).replace('"published": false',
    '"published": true')
  await writeFile(meta,forged)
  const denied=spawnSync(process.execPath,argv,{encoding:'utf8',timeout:10000})
  assert.equal(denied.status,2)
  assert.doesNotMatch(denied.stdout+denied.stderr,
    /PRIVATE_SECRET_123|€999|private-sku-secret|PRIVATE PRODUCT NAME|www\.plus\.nl/)
})

test('one private two-retailer package is complete only when both SHA-pinned sources verify',async t=>{
  const plus=await archive(t,'plus','catalog')
  const deka=await archive(t,'dekamarkt','offers')
  const out=join(plus.dir,'two-stores')
  const saved=await buildPrivateSyntheticFixturePair(plus.filename,deka.filename,out)
  assert.deepEqual([saved.created,saved.retailers,saved.published],[true,2,false])
  const checked=await verifyPrivateSyntheticFixturePair(plus.filename,deka.filename,out)
  assert.equal(checked.verified,true)
  const index=JSON.parse(await readFile(join(out,'pair-provenance.json'),'utf8'))
  assert.equal(index.schemaVersion,2)
  assert.equal(checked.sourceUrlHashBound,true)
  assert.deepEqual(index.retailers,['plus','dekamarkt'])
  assert.equal(index.sources[0].sha256,plus.capture.source.sha256)
  assert.equal(index.sources[1].sha256,deka.capture.source.sha256)
  assert.equal(index.sources[0].sourceUrlSha256,digest(plus.capture.source.url))
  assert.equal(index.sources[1].sourceUrlSha256,digest(deka.capture.source.url))
  assert.equal(index.productionEnabled,false)
  assert.equal(index.pricePublicationEnabled,false)
  assert.equal((await stat(out)).mode&0o777,0o700)
  assert.equal((await stat(join(out,'pair-provenance.json'))).mode&0o777,0o600)
  for(const retailer of ['plus','dekamarkt']) {
    const html=await readFile(join(out,retailer,'synthetic-structure.html'),'utf8')
    assert.match(html,/SYNTHETIC STRUCTURE/)
    assert.doesNotMatch(html,/PRIVATE_SECRET_123|PRIVATE PRODUCT NAME|private-sku-secret|€999/)
    assert.equal((await stat(join(out,retailer,'provenance.json'))).mode&0o777,0o600)
  }
  assert.deepEqual((await readdir(plus.dir)).filter(x=>x.startsWith('.supa-two-store-')),[])
  await assert.rejects(buildPrivateSyntheticFixturePair(plus.filename,deka.filename,out),/EEXIST/)
  assert.equal((await verifyPrivateSyntheticFixturePair(plus.filename,deka.filename,out)).verified,true)
})

test('two-store generator refuses missing or misidentified retailer and leaves no partial package',async t=>{
  const plus=await archive(t,'plus','catalog')
  const otherPlus=await archive(t,'plus','product')
  const deka=await archive(t,'dekamarkt','offers')
  const destination=join(plus.dir,'not-produced')
  await assert.rejects(buildPrivateSyntheticFixturePair(
    deka.filename,plus.filename,destination))
  await assert.rejects(buildPrivateSyntheticFixturePair(
    plus.filename,otherPlus.filename,destination))
  await assert.rejects(stat(destination),{code:'ENOENT'})
  await writeFile(deka.filename,'<p>TAMPERED</p>',{mode:0o600})
  await assert.rejects(buildPrivateSyntheticFixturePair(
    plus.filename,deka.filename,destination))
  await assert.rejects(stat(destination),{code:'ENOENT'})
  assert.deepEqual((await readdir(plus.dir)).filter(x=>x.startsWith('.supa-two-store-')),[])
})

test('two-store verifier detects tampering in either child or shared manifest',async t=>{
  const plus=await archive(t,'plus','product')
  const deka=await archive(t,'dekamarkt','offers')
  const out=join(plus.dir,'pair-verify')
  await buildPrivateSyntheticFixturePair(plus.filename,deka.filename,out)
  const globalManifest=join(out,'pair-provenance.json')
  const original=await readFile(globalManifest)
  await writeFile(globalManifest,original.toString('utf8').replace('"published": false',
    '"published": true'))
  await assert.rejects(verifyPrivateSyntheticFixturePair(plus.filename,deka.filename,out))
  await writeFile(globalManifest,original)
  const child=join(out,'dekamarkt','synthetic-structure.html')
  const good=await readFile(child)
  await writeFile(child,good.toString('utf8')+'UNREVIEWED')
  await assert.rejects(verifyPrivateSyntheticFixturePair(plus.filename,deka.filename,out))
  await writeFile(child,good)
  assert.equal((await verifyPrivateSyntheticFixturePair(plus.filename,deka.filename,out)).verified,true)
})

test('real operator two-store CLI publishes only private verified synthetic receipts',async t=>{
  const {spawnSync}=await import('node:child_process')
  const plus=await archive(t,'plus','catalog')
  const deka=await archive(t,'dekamarkt','offers')
  const out=join(plus.dir,'pair-cli')
  const executable=new URL('../scripts/retailer-private-structural-fixture.mjs',import.meta.url).pathname
  const invoke=mode=>spawnSync(process.execPath,['--experimental-strip-types',
    executable,mode,plus.filename,deka.filename,out],
    {encoding:'utf8',timeout:20000})
  const created=invoke('--pair')
  assert.equal(created.status,0,created.stderr)
  assert.equal(JSON.parse(created.stdout).retailers,2)
  const verified=invoke('--verify-pair')
  assert.equal(verified.status,0,verified.stderr)
  assert.equal(JSON.parse(verified.stdout).verified,true)
  assert.doesNotMatch(created.stdout+created.stderr+verified.stdout+verified.stderr,
    /PRIVATE_SECRET_123|private-sku-secret|PRIVATE PRODUCT NAME|€999|www\.plus\.nl|www\.dekamarkt\.nl/)
  const duplicate=invoke('--pair')
  assert.equal(duplicate.status,2)
  assert.doesNotMatch(duplicate.stdout+duplicate.stderr,/private-sku-secret|PRIVATE_SECRET_123/)
})

for(const [retailer,kind,root] of [
  ['plus','catalog','product'],
  ['dekamarkt','offers','producten'],
]) {
  test('public '+retailer+' relative and absolute product roots survive synthetic HTML replay',async t=>{
    const origin='www.'+retailer+'.nl'
    const roots=['/'+root+'/',root+'/','./'+root+'/','../'+root+'/',
      'https://'+origin+'/'+root+'/','//'+origin+'/'+root+'/']
    const sourceMarkup='<html><head><meta charset="UTF-8"></head><body>'+
      roots.map((r,i)=>'<a href="'+r+'private-identity-'+i+'">SECRET PRODUCT '+i+'</a>').join('')+
      '</body></html>'
    const {filename,dir,capture}=await archive(t,retailer,kind,sourceMarkup)
    const output=join(dir,'links-only')
    await buildPrivateSyntheticHtmlFixture(filename,output)
    const generated=await readFile(join(output,'synthetic-structure.html'),'utf8')
    const reviewed=await replayPrivateSelectorHtmlSnapshot(filename)
    const safe=summarizeOfflineSelectorProposals(reviewed.proposals).selectors
      .filter(row=>row.field==='product'&&row.selector.startsWith('a[href^='))
    assert.equal(safe.length,6)
    const reproduced=proposeOfflineRetailerSelectors({html:generated,
      origin:{retailerId:retailer,url:capture.source.url,
        capturedAt:capture.source.capturedAt}})
    const actual=new Set(reproduced.selectors.map(x=>x.field+'|'+x.selector))
    for(const row of safe)
      assert.ok(actual.has(row.field+'|'+row.selector),'lost observed public link root '+row.selector)
    assert.equal((await verifyPrivateSyntheticHtmlFixture(filename,output)).verified,true)
    assert.doesNotMatch(generated,/private-identity-|SECRET PRODUCT/)
  })
}

test('synthetic-only export refuses added original or unrelated files after creation', async t=>{
  const plus=await archive(t,'plus','catalog')
  const deka=await archive(t,'dekamarkt','offers')
  const single=join(plus.dir,'single')
  await buildPrivateSyntheticHtmlFixture(plus.filename,single)
  assert.equal((await verifyPrivateSyntheticHtmlFixture(plus.filename,single)).verified,true)
  const extra=join(single,'original-source.html')
  await writeFile(extra,plus.html,{mode:0o600})
  await assert.rejects(verifyPrivateSyntheticHtmlFixture(plus.filename,single),
    /Private synthetic structural fixture refused/)
  await unlink(extra)
  assert.equal((await verifyPrivateSyntheticHtmlFixture(plus.filename,single)).verified,true)
  const pair=join(plus.dir,'pair-extra')
  await buildPrivateSyntheticFixturePair(plus.filename,deka.filename,pair)
  assert.equal((await verifyPrivateSyntheticFixturePair(plus.filename,deka.filename,pair)).verified,true)
  const hidden=join(pair,'.unreviewed-source.html')
  await writeFile(hidden,deka.html,{mode:0o600})
  await assert.rejects(verifyPrivateSyntheticFixturePair(plus.filename,deka.filename,pair),
    /Private synthetic structural fixture refused/)
  await unlink(hidden)
  const childExtra=join(pair,'dekamarkt','unreviewed-raw.html')
  await writeFile(childExtra,deka.html,{mode:0o600})
  await assert.rejects(verifyPrivateSyntheticFixturePair(plus.filename,deka.filename,pair),
    /Private synthetic structural fixture refused/)
  await unlink(childExtra)
  assert.equal((await verifyPrivateSyntheticFixturePair(plus.filename,deka.filename,pair)).verified,true)
})

test('legacy v1 private pair keeps SHA-bound verification without falsely claiming URL hash in pair manifest',async t=>{
  const plus=await archive(t,'plus','catalog')
  const deka=await archive(t,'dekamarkt','offers')
  const dir=join(plus.dir,'legacy-pair')
  await buildPrivateSyntheticFixturePair(plus.filename,deka.filename,dir)
  const path=join(dir,'pair-provenance.json')
  const legacy=JSON.parse(await readFile(path,'utf8'))
  legacy.schemaVersion=1
  for(const source of legacy.sources) delete source.sourceUrlSha256
  await writeFile(path,JSON.stringify(legacy,null,2)+'\n',{mode:0o600})
  const checked=await verifyPrivateSyntheticFixturePair(plus.filename,deka.filename,dir)
  assert.equal(checked.verified,true)
  assert.equal(checked.sourceUrlHashBound,false)
  legacy.schemaVersion=2
  await writeFile(path,JSON.stringify(legacy,null,2)+'\n',{mode:0o600})
  await assert.rejects(verifyPrivateSyntheticFixturePair(plus.filename,deka.filename,dir))
  legacy.schemaVersion=3
  await writeFile(path,JSON.stringify(legacy,null,2)+'\n',{mode:0o600})
  await assert.rejects(verifyPrivateSyntheticFixturePair(plus.filename,deka.filename,dir))
})
