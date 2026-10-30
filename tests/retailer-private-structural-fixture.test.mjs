import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtemp,writeFile,readFile,stat,rm,link,unlink,symlink,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {buildPrivateSyntheticHtmlFixture,verifyPrivateSyntheticHtmlFixture,buildPrivateSyntheticFixturePair,verifyPrivateSyntheticFixturePair,comparePrivateSyntheticFixturePairs} from '../scripts/retailer-private-structural-fixture.mjs'
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

test('pair recapture comparison detects source and selector drift without exposing prices',async t=>{
  const oldP=await archive(t,'plus','catalog'),oldD=await archive(t,'dekamarkt','offers')
  const p=await archive(t,'plus','catalog',oldP.html.replace('product-card','new-card'))
  const d=await archive(t,'dekamarkt','offers')
  const oldDir=join(oldP.dir,'before'),newDir=join(p.dir,'after')
  for(const record of [p,d]){
    const file=record.filename+'.manifest.json'
    const manifest=JSON.parse(await readFile(file,'utf8'))
    manifest.source.capturedAt='2026-10-15T12:00:00.000Z'
    await writeFile(file,JSON.stringify(manifest,null,2)+'\n',{mode:0o600})
  }
  await buildPrivateSyntheticFixturePair(oldP.filename,oldD.filename,oldDir)
  await buildPrivateSyntheticFixturePair(p.filename,d.filename,newDir)
  const args=[oldP.filename,oldD.filename,oldDir,p.filename,d.filename,newDir]
  const result=await comparePrivateSyntheticFixturePairs(...args)
  assert.equal(result.verified,true)
  assert.equal(result.allCapturesAdvanced,true)
  assert.equal(result.anySelectorDrift,true)
  assert.deepEqual(result.retailers.map(x=>x.outcome),
    ['review-selector-drift','unchanged-recapture'])
  assert.equal(result.priceClaimsEligible,false)
  assert.ok(result.retailers.every(x=>x.humanReviewRequired))
  const {spawnSync}=await import('node:child_process')
  const executable=new URL('../scripts/retailer-private-structural-fixture.mjs',import.meta.url).pathname
  const cli=spawnSync(process.execPath,['--experimental-strip-types',executable,'--compare-pair',...args],
    {encoding:'utf8',timeout:20000})
  assert.equal(cli.status,0,cli.stderr)
  assert.deepEqual(JSON.parse(cli.stdout),result)
  assert.doesNotMatch(cli.stdout+cli.stderr,/PRIVATE_SECRET|PRIVATE PRODUCT NAME|€999|www\.plus\.nl/)
  const path=join(newDir,'pair-provenance.json')
  const original=await readFile(path)
  await writeFile(path,original.toString('utf8').replace('"published": false','"published": true'))
  await assert.rejects(comparePrivateSyntheticFixturePairs(...args))
})

test('same-time changed HTML is stale and older v1 pairs do not promote newer v1 evidence',async t=>{
  const oldP=await archive(t,'plus','catalog'),oldD=await archive(t,'dekamarkt','offers')
  const newP=await archive(t,'plus','catalog',oldP.html.replace('PRIVATE_SECRET_123','ANOTHER_SECRET'))
  const newD=await archive(t,'dekamarkt','offers')
  const oldDir=join(oldP.dir,'old-pair'),newDir=join(newP.dir,'new-pair')
  await buildPrivateSyntheticFixturePair(oldP.filename,oldD.filename,oldDir)
  await buildPrivateSyntheticFixturePair(newP.filename,newD.filename,newDir)
  async function toLegacy(dir){
    const file=join(dir,'pair-provenance.json')
    const manifest=JSON.parse(await readFile(file,'utf8'))
    manifest.schemaVersion=1
    for(const entry of manifest.sources) delete entry.sourceUrlSha256
    await writeFile(file,JSON.stringify(manifest,null,2)+'\n',{mode:0o600})
  }
  await toLegacy(oldDir)
  const args=[oldP.filename,oldD.filename,oldDir,newP.filename,newD.filename,newDir]
  const result=await comparePrivateSyntheticFixturePairs(...args)
  assert.equal(result.allCapturesAdvanced,false)
  assert.equal(result.retailers[0].htmlChanged,true)
  assert.equal(result.retailers[0].outcome,'stale-capture')
  await toLegacy(newDir)
  await assert.rejects(comparePrivateSyntheticFixturePairs(...args))
})

test('real microdata selector survives SHA-bound private archive to synthetic topology and replay',async t=>{
  for(const retailer of ['plus','dekamarkt']) {
    const src='<html><head><meta charset="UTF-8"></head><body>'+
      '<article itemscope itemtype="https://schema.org/Product">'+
      '<span itemprop="name">PRIVATE_NAME_DO_NOT_EXPORT</span></article></body></html>'
    const {filename,dir,capture}=await archive(t,retailer,retailer==='plus'?'catalog':'offers',src)
    const result=join(dir,'microdata-synthetic')
    await buildPrivateSyntheticHtmlFixture(filename,result)
    const html=await readFile(join(result,'synthetic-structure.html'),'utf8')
    const selector='article[itemtype="https://schema.org/Product"]'
    assert.match(html,/itemscope itemtype="https:\/\/schema.org\/Product"/)
    assert.doesNotMatch(html,/PRIVATE_NAME_DO_NOT_EXPORT/)
    const roundtrip=proposeOfflineRetailerSelectors({html,origin:{
      retailerId:retailer,url:capture.source.url,capturedAt:capture.source.capturedAt}})
    assert.ok(roundtrip.selectors.some(x=>x.field==='product'&&x.selector===selector))
    assert.equal((await verifyPrivateSyntheticHtmlFixture(filename,result)).verified,true)
  }
})

test('anchor-backed Product microdata survives private source to review-only HTML export',async t=>{
  const source='<html><head><meta charset="UTF-8"></head><body>'+
    '<a itemscope itemtype="https://schema.org/Product" '+
    'href="/product/private-do-not-export"><span itemprop="name">'+
    'PRIVATE_ANCHOR_NAME</span></a></body></html>'
  const {filename,dir,capture}=await archive(t,'plus','catalog',source)
  const out=join(dir,'microdata-anchor')
  const built=await buildPrivateSyntheticHtmlFixture(filename,out)
  assert.equal(built.productionEnabled,false)
  const html=await readFile(join(out,'synthetic-structure.html'),'utf8')
  assert.match(html,/a itemscope itemtype="https:\/\/schema.org\/Product"/)
  assert.doesNotMatch(html,/PRIVATE_ANCHOR_NAME|private-do-not-export/)
  const replay=proposeOfflineRetailerSelectors({html,origin:{
    retailerId:'plus',url:capture.source.url,capturedAt:capture.source.capturedAt}})
  assert.ok(replay.selectors.some(x=>x.field==='product'&&
    x.selector==='a[itemtype="https://schema.org/Product"]'))
  assert.equal((await verifyPrivateSyntheticHtmlFixture(filename,out)).verified,true)
})

test('real observed meta itemprop price is replayed as a void structural node, without value',async t=>{
  for(const retailer of ['plus','dekamarkt']) {
    const source='<html><head><meta charset="UTF-8"></head><body>'+
      '<article class="product-card" itemscope itemtype="https://schema.org/Product">'+
      '<span itemprop="name">PRIVATE_NAME_DO_NOT_EXPORT</span>'+
      '<meta itemprop="price" content="123.45">'+
      '</article></body></html>'
    const kind=retailer==='plus'?'catalog':'offers'
    const {filename,dir,capture}=await archive(t,retailer,kind,source)
    const out=join(dir,'sanitized-microdata-price')
    await buildPrivateSyntheticHtmlFixture(filename,out)
    const html=await readFile(join(out,'synthetic-structure.html'),'utf8')
    const selector='meta[itemprop="price"]'
    assert.match(html,/<meta itemprop="price" data-synthetic="true">/)
    assert.doesNotMatch(html,/content="123.45"|PRIVATE_NAME_DO_NOT_EXPORT|<\/meta>/)
    const replay=proposeOfflineRetailerSelectors({html,origin:{
      retailerId:retailer,url:capture.source.url,capturedAt:capture.source.capturedAt}})
    assert.ok(replay.selectors.some(row=>row.field==='price'&&row.selector===selector))
    assert.equal(replay.readyForIngestion,false)
    assert.equal(replay.productionEnabled,false)
    assert.equal((await verifyPrivateSyntheticHtmlFixture(filename,out)).verified,true)
  }
})

test('private retailer Offer microdata creates structural link/data/time with no sensitive values',async t=>{
  for(const retailer of ['plus','dekamarkt']){
    const html='<html><head><meta charset="UTF-8"></head><body>'+
      '<article itemscope itemtype="https://schema.org/Product">'+
      '<div itemprop="offers" itemscope itemtype="https://schema.org/Offer">'+
      '<data itemprop="lowPrice" value="123.45">PRIVATE_123</data>'+
      '<meta itemprop="priceCurrency" content="EUR">'+
      '<link itemprop="availability" href="https://schema.org/OutOfStock">'+
      '<time itemprop="priceValidUntil" datetime="2026-12-01">PRIVATE_DATE</time>'+
      '</div><span itemprop="unitText">PRIVATE_PACK</span></article></body></html>'
    const kind=retailer==='plus'?'catalog':'offers'
    const {filename,dir,capture}=await archive(t,retailer,kind,html)
    const out=join(dir,'offer-microdata-structure')
    await buildPrivateSyntheticHtmlFixture(filename,out)
    const transformed=await readFile(join(out,'synthetic-structure.html'),'utf8')
    assert.match(transformed,/<link itemprop="availability" data-synthetic="true">/)
    assert.match(transformed,/<data itemprop="lowPrice" data-synthetic="true">/)
    assert.match(transformed,/<time itemprop="priceValidUntil" data-synthetic="true">/)
    assert.doesNotMatch(transformed,/PRIVATE_123|PRIVATE_PACK|PRIVATE_DATE|123\.45|OutOfStock|datetime=|value=|<\/link>/)
    const replay=proposeOfflineRetailerSelectors({html:transformed,origin:{
      retailerId:retailer,url:capture.source.url,capturedAt:capture.source.capturedAt}})
    const expected=['link[itemprop="availability"]','data[itemprop="lowPrice"]',
      'time[itemprop="priceValidUntil"]','div[itemprop="offers"]']
    for(const selector of expected)
      assert.ok(replay.selectors.some(row=>row.selector===selector),
        'unreplayable source-observed Offer selector '+selector)
    assert.equal((await verifyPrivateSyntheticHtmlFixture(filename,out)).verified,true)
    assert.equal(replay.readyForIngestion,false)
  }
})

test('SHA-bound two-store synthetic fixture preserves observed anchor and strong Schema.org itemprop tags',async t=>{
  for(const [retailerId,root] of [['plus','/product/'],['dekamarkt','/producten/']]) {
    const privateHtml='<article itemscope itemtype="https://schema.org/Product">'+
      `<a itemprop="name" href="${root}private-sku-991">PRIVATE_ITEM_NAME</a>`+
      '<strong itemprop="price">PRIVATE_7.99</strong></article>'
    const {filename,dir}=await archive(t,retailerId,'product',privateHtml)
    const out=join(dir,'safe-structural-review')
    await buildPrivateSyntheticHtmlFixture(filename,out)
    const replay=await readFile(join(out,'synthetic-structure.html'),'utf8')
    assert.match(replay,/<a itemprop="name" data-synthetic="true">/)
    assert.match(replay,/<strong itemprop="price" data-synthetic="true">/)
    assert.doesNotMatch(replay,/PRIVATE_ITEM_NAME|PRIVATE_7.99|private-sku-991/)
    const verified=await verifyPrivateSyntheticHtmlFixture(filename,out)
    assert.equal(verified.verified,true)
    assert.equal(verified.productionEnabled,false)
  }
})

test('observed retailer custom web components survive both-store private SHA HTML fixture generation and replay', async t => {
  for (const retailerId of ['plus','dekamarkt']) {
    const markup = '<retailer-product-card class="product-card" data-testid="product-card">' +
      '<retailer-price-label data-testid="price-value">PRIVATE_CUSTOM_PRICE_991</retailer-price-label>' +
      '<retailer-pack-size class="pack-size">PRIVATE_CUSTOM_PACK_500</retailer-pack-size>' +
      '</retailer-product-card>'
    const {filename,dir,capture} = await archive(t,retailerId,retailerId==='plus'?'catalog':'offers',markup)
    const output=join(dir,'private-custom-synthetic')
    await buildPrivateSyntheticHtmlFixture(filename,output)
    const generated=await readFile(join(output,'synthetic-structure.html'),'utf8')
    const selectors=proposeOfflineRetailerSelectors({html:generated,origin:{
      retailerId,url:capture.source.url,capturedAt:capture.source.capturedAt,
    }}).selectors
    for (const selector of [
      'retailer-product-card.product-card',
      'retailer-product-card[data-testid="product-card"]',
      'retailer-price-label[data-testid="price-value"]',
      'retailer-pack-size.pack-size',
    ]) assert.ok(selectors.some(x=>x.selector===selector),retailerId+': '+selector)
    assert.doesNotMatch(generated,/PRIVATE_CUSTOM_PRICE_991|PRIVATE_CUSTOM_PACK_500/)
    assert.equal((await verifyPrivateSyntheticHtmlFixture(filename,output)).verified,true)
  }
})

test('private synthetic HTML cannot copy SKU/price-bearing custom element tag names',async t=>{
  for(const retailerId of ['plus','dekamarkt']) {
    const html='<retailer-product-card class="product-card">Synthetic safe card</retailer-product-card>'+
      '<retailer-product-991-card class="product-card">PRIVATE_SKU_991</retailer-product-991-card>'+
      '<customer-secret-name-card data-testid="price-value">PRIVATE_VALUE</customer-secret-name-card>'
    const {filename,dir}=await archive(t,retailerId,retailerId==='plus'?'catalog':'offers',html)
    const out=join(dir,'anonymous-structure')
    await buildPrivateSyntheticHtmlFixture(filename,out)
    const generated=await readFile(join(out,'synthetic-structure.html'),'utf8')
    assert.match(generated,/<retailer-product-card class="product-card"/)
    assert.doesNotMatch(generated,/retailer-product-991|customer-secret-name|PRIVATE_SKU|PRIVATE_VALUE/)
    assert.equal((await verifyPrivateSyntheticHtmlFixture(filename,out)).verified,true)
  }
})

test('Deka canonical catalog root accepted by shared source capture route replays into SHA-private HTML',async t=>{
  const {filename,dir,capture}=await archive(t,'dekamarkt','catalog')
  assert.equal(capture.source.url,'https://www.dekamarkt.nl/producten')
  const original=await replayPrivateSelectorHtmlSnapshot(filename)
  assert.equal(original.source.kind,'catalog')
  const out=join(dir,'deka-root-reviewed')
  const created=await buildPrivateSyntheticHtmlFixture(filename,out)
  assert.equal(created.created,true)
  const manifest=JSON.parse(await readFile(join(out,'provenance.json'),'utf8'))
  assert.equal(manifest.source.sha256,capture.source.sha256)
  assert.equal(manifest.productionEnabled,false)
  assert.equal((await verifyPrivateSyntheticHtmlFixture(filename,out)).verified,true)
})

test('PLUS/Deka source-observed h1 to h6 fields survive SHA-private fixture generation',async t=>{
  for(const retailerId of ['plus','dekamarkt']){
    const html='<section itemscope itemtype="https://schema.org/Product">' +
      '<h1 itemprop="name">PRIVATE_NAME_DO_NOT_COPY</h1>' +
      '<h4 class="price-value">PRIVATE_2.49</h4>' +
      '<h5 data-testid="pack-size">PRIVATE_500ml</h5>' +
      '<h6 itemprop="availability">PRIVATE_IN_STOCK</h6></section>'
    const {filename,dir,capture}=await archive(t,retailerId,retailerId==='plus'?'catalog':'offers',html)
    const out=join(dir,'heading-synthetic')
    await buildPrivateSyntheticHtmlFixture(filename,out)
    const generated=await readFile(join(out,'synthetic-structure.html'),'utf8')
    const replay=proposeOfflineRetailerSelectors({html:generated,origin:{
      retailerId,url:capture.source.url,capturedAt:capture.source.capturedAt}})
    for(const selector of ['h1[itemprop="name"]','h4.price-value',
      'h5[data-testid="pack-size"]','h6[itemprop="availability"]']){
      assert.ok(replay.selectors.some(x=>x.selector===selector),retailerId+' '+selector)
    }
    assert.doesNotMatch(generated,/PRIVATE_NAME|PRIVATE_2\.49|PRIVATE_500ml|PRIVATE_IN_STOCK/)
    assert.equal((await verifyPrivateSyntheticHtmlFixture(filename,out)).verified,true)
  }
})

test('PLUS/Deka catalog or offers retain observed ins/del/small price, promotion and pack structures',async t=>{
  for(const retailerId of ['plus','dekamarkt']){
    const html='<article itemscope itemtype="https://schema.org/Product">' +
      '<ins itemprop="price">PRIVATE_CURRENT_2.49</ins>'+
      '<del class="offer-label">PRIVATE_OLD_3.99</del>'+
      '<small data-testid="pack-size">PRIVATE_500_G</small></article>'
    const {filename,dir,capture}=await archive(t,retailerId,retailerId==='plus'?'catalog':'offers',html)
    const out=join(dir,'private-price-structure')
    await buildPrivateSyntheticHtmlFixture(filename,out)
    const generated=await readFile(join(out,'synthetic-structure.html'),'utf8')
    const replay=proposeOfflineRetailerSelectors({html:generated,origin:{retailerId,
      url:capture.source.url,capturedAt:capture.source.capturedAt}})
    for(const selector of ['ins[itemprop="price"]','del.offer-label',
      'small[data-testid="pack-size"]']){
      assert.ok(replay.selectors.some(x=>x.selector===selector),retailerId+': '+selector)
    }
    assert.doesNotMatch(generated,/PRIVATE_CURRENT|PRIVATE_OLD|PRIVATE_500_G/)
    assert.equal((await verifyPrivateSyntheticHtmlFixture(filename,out)).verified,true)
  }
})

test('private synthetic Deka/PLUS offer fixture retains old-price hint separately from current-price selector',async t=>{
  for(const retailerId of ['plus','dekamarkt']){
    const html='<article><del class="price-value" itemprop="price">PRIVATE_9.99</del>'+
      '<ins class="price-value" itemprop="price">PRIVATE_7.99</ins></article>'
    const {filename,dir,capture}=await archive(t,retailerId,retailerId==='plus'?'catalog':'offers',html)
    const output=join(dir,'old-vs-current-price')
    await buildPrivateSyntheticHtmlFixture(filename,output)
    const sanitized=await readFile(join(output,'synthetic-structure.html'),'utf8')
    const replay=proposeOfflineRetailerSelectors({html:sanitized,origin:{
      retailerId,url:capture.source.url,capturedAt:capture.source.capturedAt}})
    for(const selector of ['del.price-value','del[itemprop="price"]'])
      assert.equal(replay.selectors.find(x=>x.selector===selector)?.field,'offer',selector)
    for(const selector of ['ins.price-value','ins[itemprop="price"]'])
      assert.equal(replay.selectors.find(x=>x.selector===selector)?.field,'price',selector)
    assert.doesNotMatch(sanitized,/PRIVATE_9\.99|PRIVATE_7\.99/)
    assert.equal((await verifyPrivateSyntheticHtmlFixture(filename,output)).verified,true)
  }
})

test('SHA-private fixture replay distinguishes product cards from child title/price tokens',async t=>{
  for(const retailerId of ['plus','dekamarkt']){
    const html='<section class="product-card">'+
      '<span class="product-name" data-testid="product-title">PRIVATE_NAME</span>'+
      '<span class="product-price" data-testid="product-price">PRIVATE_PRICE</span></section>'
    const {filename,dir,capture}=await archive(t,retailerId,retailerId==='plus'?'catalog':'offers',html)
    const out=join(dir,'field-correct-private')
    await buildPrivateSyntheticHtmlFixture(filename,out)
    const synthetic=await readFile(join(out,'synthetic-structure.html'),'utf8')
    const report=proposeOfflineRetailerSelectors({html:synthetic,origin:{
      retailerId,url:capture.source.url,capturedAt:capture.source.capturedAt}})
    for(const [selector,field] of [
      ['section.product-card','product'],['span.product-name','name'],
      ['span[data-testid="product-title"]','name'],
      ['span.product-price','price'],['span[data-testid="product-price"]','price']])
      assert.deepEqual(report.selectors.filter(x=>x.selector===selector).map(x=>x.field),[field],retailerId+' '+selector)
    assert.equal(report.selectors.filter(x=>x.field==='product').length,1)
    assert.doesNotMatch(synthetic,/PRIVATE_NAME|PRIVATE_PRICE/)
    assert.equal((await verifyPrivateSyntheticHtmlFixture(filename,out)).verified,true)
  }
})

test('two-retailer older sale-price <s>/<strike> tags survive SHA-private replay only as offer hints',async t=>{
  for(const retailerId of ['plus','dekamarkt']){
    const html='<article class="product-card">'+
      '<s class="price-value" itemprop="price">PRIVATE_OLD_3.99</s>'+
      '<strike data-testid="price-value">PRIVATE_OLD_4.99</strike>'+
      '<ins class="price-value">PRIVATE_NEW_2.49</ins></article>'
    const {filename,dir,capture}=await archive(t,retailerId,retailerId==='plus'?'catalog':'offers',html)
    const origin={retailerId,url:capture.source.url,capturedAt:capture.source.capturedAt}
    const direct=proposeOfflineRetailerSelectors({html,origin})
    for(const selector of ['s.price-value','s[itemprop="price"]','strike[data-testid="price-value"]'])
      assert.equal(direct.selectors.find(row=>row.selector===selector)?.field,'offer',retailerId+' direct '+selector)
    assert.equal(direct.selectors.find(row=>row.selector==='ins.price-value')?.field,'price')
    const output=join(dir,'private-previous-prices')
    await buildPrivateSyntheticHtmlFixture(filename,output)
    const sanitized=await readFile(join(output,'synthetic-structure.html'),'utf8')
    const replay=proposeOfflineRetailerSelectors({html:sanitized,origin})
    for(const selector of ['s.price-value','s[itemprop="price"]','strike[data-testid="price-value"]'])
      assert.equal(replay.selectors.find(row=>row.selector===selector)?.field,'offer',retailerId+' replay '+selector)
    assert.equal(replay.selectors.find(row=>row.selector==='ins.price-value')?.field,'price')
    assert.doesNotMatch(sanitized,/PRIVATE_OLD|PRIVATE_NEW/)
    assert.equal((await verifyPrivateSyntheticHtmlFixture(filename,output)).verified,true)
  }
})

test('retailer price-before/old-price DOM hints are never counted as the current shelf price',async t=>{
  for(const retailerId of ['plus','dekamarkt']){
    const html='<article class="product-card">'+
      '<span class="old-price" data-testid="price-before">PRIVATE_OLD_3.99</span>'+
      '<span class="price-old">PRIVATE_OLD_4.99</span>'+
      '<ins class="product-price">PRIVATE_CURRENT_2.49</ins></article>'
    const {filename,dir,capture}=await archive(t,retailerId,retailerId==='plus'?'catalog':'offers',html)
    const origin={retailerId,url:capture.source.url,capturedAt:capture.source.capturedAt}
    const report=proposeOfflineRetailerSelectors({html,origin})
    for(const selector of ['span.old-price','span[data-testid="price-before"]','span.price-old'])
      assert.deepEqual(report.selectors.filter(row=>row.selector===selector).map(row=>row.field),['offer'],retailerId+': '+selector)
    assert.equal(report.selectors.find(row=>row.selector==='ins.product-price')?.field,'price')
    const out=join(dir,'private-prior-price-classes')
    await buildPrivateSyntheticHtmlFixture(filename,out)
    const sanitized=await readFile(join(out,'synthetic-structure.html'),'utf8')
    const replay=proposeOfflineRetailerSelectors({html:sanitized,origin})
    for(const selector of ['span.old-price','span[data-testid="price-before"]','span.price-old'])
      assert.deepEqual(replay.selectors.filter(row=>row.selector===selector).map(row=>row.field),['offer'],retailerId+' replay '+selector)
    assert.equal(replay.selectors.find(row=>row.selector==='ins.product-price')?.field,'price')
    assert.doesNotMatch(sanitized,/PRIVATE_OLD|PRIVATE_CURRENT/)
    assert.equal((await verifyPrivateSyntheticHtmlFixture(filename,out)).verified,true)
  }
})

test('SHA-private replay suppresses ambiguous shared price CSS from old and new shelves',async t=>{
  for(const retailerId of ['plus','dekamarkt']){
    const html='<article class="product-card">'+
      '<span class="old-price price-value" data-testid="price-value" itemprop="price">PRIVATE_PRIOR_4.99</span>'+
      '<span class="product-price" itemprop="price">PRIVATE_CURRENT_2.49</span></article>'
    const {filename,dir,capture}=await archive(t,retailerId,retailerId==='plus'?'catalog':'offers',html)
    const origin={retailerId,url:capture.source.url,capturedAt:capture.source.capturedAt}
    const output=join(dir,'unambiguous-price-only')
    await buildPrivateSyntheticHtmlFixture(filename,output)
    const synthetic=await readFile(join(output,'synthetic-structure.html'),'utf8')
    const replay=proposeOfflineRetailerSelectors({html:synthetic,origin})
    for(const selector of ['span[itemprop="price"]','span.price-value','span[data-testid="price-value"]'])
      assert.equal(replay.selectors.some(x=>x.selector===selector),false,selector)
    assert.equal(replay.selectors.find(x=>x.selector==='span.old-price')?.field,'offer')
    assert.equal(replay.selectors.find(x=>x.selector==='span.product-price')?.field,'price')
    assert.doesNotMatch(synthetic,/PRIVATE_PRIOR|PRIVATE_CURRENT/)
    assert.equal((await verifyPrivateSyntheticHtmlFixture(filename,output)).verified,true)
  }
})

test('noisy 160-selector retailer listings still preserve source-observed product, price, pack, sale and stock reviews',async t=>{
  const clutter=Array.from({length:80},(_,i)=>
    '<span class="price-noise-'+i+' stock-noise-'+i+'">PRIVATE_NOISE</span>').join('')
  for(const retailerId of ['plus','dekamarkt']){
    const html='<article class="product-card">'+clutter+
      '<h2 class="product-title">PRIVATE_NAME</h2>'+
      '<span class="price-value">PRIVATE_PRICE</span>'+
      '<span class="pack-size">PRIVATE_PACK</span>'+
      '<span class="offer-label">PRIVATE_OFFER</span>'+
      '<span class="stock-label">PRIVATE_AVAILABILITY</span></article>'
    const {filename,dir,capture}=await archive(t,retailerId,retailerId==='plus'?'catalog':'offers',html)
    const origin={retailerId,url:capture.source.url,capturedAt:capture.source.capturedAt}
    const original=proposeOfflineRetailerSelectors({html,origin},true)
    assert.equal(original.selectors.length,24)
    assert.equal(original.candidateLimitReached,true)
    const safe=summarizeOfflineSelectorProposals(original)
    for(const [field,selector] of [
      ['product','article.product-card'],['name','h2.product-title'],
      ['price','span.price-value'],['pack','span.pack-size'],
      ['offer','span.offer-label'],['availability','span.stock-label']])
      assert.ok(safe.selectors.some(x=>x.selector===selector&&x.field===field),retailerId+' '+field)
    const out=join(dir,'diverse-selector-replay')
    await buildPrivateSyntheticHtmlFixture(filename,out)
    const generated=await readFile(join(out,'synthetic-structure.html'),'utf8')
    const replay=proposeOfflineRetailerSelectors({html:generated,origin})
    for(const field of ['product','name','price','pack','offer','availability'])
      assert.ok(replay.selectors.some(x=>x.field===field),retailerId+' replay '+field)
    assert.doesNotMatch(generated,/PRIVATE_NOISE|PRIVATE_NAME|PRIVATE_PRICE|PRIVATE_PACK|PRIVATE_OFFER|PRIVATE_AVAILABILITY/)
    assert.equal((await verifyPrivateSyntheticHtmlFixture(filename,out)).verified,true)
  }
})

test('two-retailer source-observed multi-type Schema.org Product/Thing microdata survives private review',async t=>{
  for(const retailerId of ['plus','dekamarkt']){
    const type='https://schema.org/Product https://schema.org/Thing'
    const html='<section itemscope itemtype="'+type+'"><span itemprop="name">PRIVATE_NAME</span></section>'
    const {filename,dir,capture}=await archive(t,retailerId,retailerId==='plus'?'catalog':'offers',html)
    const origin={retailerId,url:capture.source.url,capturedAt:capture.source.capturedAt}
    const selector='section[itemtype="'+type+'"]'
    const direct=proposeOfflineRetailerSelectors({html,origin})
    assert.equal(direct.structuredSignals.schemaOrgProduct,true)
    assert.equal(direct.selectors.find(x=>x.selector===selector)?.field,'product',retailerId)
    assert.equal(summarizeOfflineSelectorProposals(direct).selectors.find(x=>x.selector===selector)?.field,'product')
    const out=join(dir,'schema-multitype')
    await buildPrivateSyntheticHtmlFixture(filename,out)
    const synthetic=await readFile(join(out,'synthetic-structure.html'),'utf8')
    const replay=proposeOfflineRetailerSelectors({html:synthetic,origin})
    assert.equal(replay.selectors.find(x=>x.selector===selector)?.field,'product',retailerId)
    assert.equal((await verifyPrivateSyntheticHtmlFixture(filename,out)).verified,true)
    assert.doesNotMatch(synthetic,/PRIVATE_NAME/)
  }
})
