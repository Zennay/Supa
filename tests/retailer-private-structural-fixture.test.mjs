import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {buildPrivateSyntheticHtmlFixture} from '../scripts/retailer-private-structural-fixture.mjs'

const digest=x=>createHash('sha256').update(x).digest('hex')
async function archive(t,retailerId,kind) {
  const dir=await mkdtemp(join(tmpdir(),'supa-structural-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  const root=retailerId==='plus'?'/product/':'/producten/'
  const srcUrl='https://www.'+(retailerId==='plus'?'plus':'dekamarkt')+
    '.nl/'+(kind==='product'?root.slice(1)+'synthetic-321':
      kind==='catalog'?'producten':'aanbiedingen')
  const html='<html><head><meta charset="UTF-8"></head><body>'+
    '<article class="product-card"><span class="product-name">PRIVATE_SECRET_123</span>'+
    '<span class="price-label">€999,99</span><a href="'+root+
    'private-sku-secret">PRIVATE PRODUCT NAME</a></article></body></html>'
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
    assert.equal(manifest.source.sha256,capture.source.sha256)
    assert.equal(manifest.source.kind,kind)
    assert.equal(manifest.syntheticHtmlSha256,digest(transformed))
    assert.equal(manifest.originalHtmlRetained,false)
    assert.equal(manifest.sourcePricesRetained,false)
    assert.equal(manifest.productionEnabled,false)
    assert.equal((await stat(output)).mode&0o777,0o700)
    assert.equal((await stat(join(output,'synthetic-structure.html'))).mode&0o777,0o600)
    assert.equal((await stat(join(output,'provenance.json'))).mode&0o777,0o600)
    await assert.rejects(buildPrivateSyntheticHtmlFixture(filename,output),/EEXIST/)
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
