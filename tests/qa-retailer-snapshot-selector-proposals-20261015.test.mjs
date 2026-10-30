import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, symlink, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  proposeRetailerSelectors,
  proposeFromM1CaptureDirectory,
} from '../scripts/retailer-snapshot-selector-proposals.mjs'

const hash = s => createHash('sha256').update(s).digest('hex')
const plusHtml = '<!doctype html><html><body>' +
  '<div class="plp-item-name product-card"><h3>FAKE_PRIVATE_PRODUCT_NAME</h3></div>' +
  '<span class="product-header-price-integer">19.</span>' +
  '<span class="product-header-price-decimals">99</span>' +
  '<template><div class="product-secret-hidden">DO_NOT_TRUST</div></template>' +
  '<script type="application/ld+json">' +
  JSON.stringify({ '@context':'https://schema.org', '@type':'Product',name:'SENSITIVE_FAKE_NAME',
    sku:'SECRET_PRODUCT_42',offers:{ '@type':'Offer',price:19.99,priceCurrency:'EUR' } }) +
  '</script></body></html>'
const dekaHtml = '<!doctype html><html><body>' +
  '<div class="product-offers-card"><span class="offer-price">DO_NOT_EXPORT_1_99</span></div>' +
  '<script type="application/json" id="__NUXT_DATA__">[{"price":1.99}]</script>' +
  '<script type="application/ld+json">{"@type":"Product","name":"DEKA_SECRET"}</script></body></html>'
const source = (supermarket, kind, html) => ({
  id: 'fictional-' + supermarket + '-' + kind,
  supermarket, kind,
  requestedUrl: supermarket === 'plus' ? 'https://www.plus.nl/producten' : 'https://www.dekamarkt.nl/aanbiedingen',
  capturedAt: '2026-10-04T12:00:00.000Z', sha256: hash(html),
})

test('offline PLUS: discover actual structural class candidates and JSON-LD shape, never raw product names or prices', () => {
  const before = plusHtml
  const result = proposeRetailerSelectors(source('plus', 'catalog', plusHtml), plusHtml)
  assert.equal(result.readyForScraping, false)
  assert.equal(result.publicationAllowed, false)
  assert.equal(result.currentPricesExtracted, false)
  assert.ok(result.proposedSelectors.some(s => s.selector === 'div.plp-item-name' && s.status === 'UNVERIFIED_PROPOSAL'))
  assert.ok(result.proposedSelectors.some(s => s.selector === 'span.product-header-price-integer'))
  assert.deepEqual(result.embeddedSignals.jsonLdTypes, ['Offer', 'Product'])
  assert.ok(result.embeddedSignals.jsonLdKeys.includes('price'))
  assert.ok(!result.proposedSelectors.some(s => s.selector.includes('product-secret-hidden')))
  const published = JSON.stringify(result)
  for (const privateText of ['FAKE_PRIVATE_PRODUCT_NAME', 'SENSITIVE_FAKE_NAME', 'SECRET_PRODUCT_42', '19.99', 'DO_NOT_TRUST']) {
    assert.ok(!published.includes(privateText), 'proposal leaked a source value ' + privateText)
  }
  assert.equal(plusHtml, before)
})

test('offline DekaMarkt: Nuxt shape signal is a proposal, not a guessed product selector', () => {
  const result = proposeRetailerSelectors(source('dekamarkt', 'offers', dekaHtml), dekaHtml)
  assert.equal(result.embeddedSignals.nuxtDataScriptPresent, true)
  assert.ok(result.proposedSelectors.some(s => s.selector === 'div.product-offers-card'))
  assert.ok(result.proposedSelectors.some(s => s.selector === 'span.offer-price'))
  assert.equal(result.sourcePermissionVerified, false)
  assert.doesNotMatch(JSON.stringify(result), /DEKA_SECRET|DO_NOT_EXPORT_1_99/)
})

test('offline discovery rejects tampered bytes, wrong host, embedded credentials, missing SHA and oversized HTML', async t => {
  const bad = [
    ['tampered', s => {}, plusHtml + '<p>modified</p>'],
    ['wrong SHA', s => { s.sha256 = '0'.repeat(64) }, plusHtml],
    ['unapproved host', s => { s.requestedUrl = 'https://www.other-supermarket.example/producten' }, plusHtml],
    ['credentials', s => { s.requestedUrl = 'https://person:secret@www.plus.nl/producten' }, plusHtml],
    ['wrong kind', s => { s.kind = 'special-api' }, plusHtml],
    ['null SHA', s => { s.sha256 = null }, plusHtml],
    ['oversized', s => {}, ' '.repeat(5 * 1024 * 1024 + 1)],
  ]
  for (const [name, mutate, body] of bad) await t.test(name, () => {
    const item = source('plus', 'catalog', plusHtml)
    mutate(item)
    assert.throws(() => proposeRetailerSelectors(item, body), /Offline selector review refused:/)
  })
})

test('offline directory analysis verifies manifest and sha, never performs HTTP and never promotes selectors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-selector-'))
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('offline discovery may not fetch') }
  try {
    await mkdir(join(dir, 'plus'))
    await writeFile(join(dir, 'plus', 'fictional-plus-catalog.html'), plusHtml)
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({
      sourceCount: 1,
      results: [{
        ...source('plus', 'catalog', plusHtml),
        success: true, finalUrl: 'https://www.plus.nl/producten',
      }],
    }))
    const report = await proposeFromM1CaptureDirectory(dir)
    assert.equal(report.analyzedSources, 1)
    assert.equal(report.productionEnabled, false)
    assert.equal(report.automatedSelectorPromotion, false)
    assert.equal(report.selectorSets[0].source.sha256, hash(plusHtml))
    await writeFile(join(dir, 'plus', 'fictional-plus-catalog.html'), plusHtml + ' ')
    await assert.rejects(proposeFromM1CaptureDirectory(dir), /match source SHA-256/)
  } finally {
    globalThis.fetch = originalFetch
    await rm(dir, { recursive: true, force: true })
  }
})

test('offline selector CLI writes a private new artifact and rejects overwrite and symlinked capture', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'supa-selector-cli-'))
  const capture = join(temp, 'capture')
  const out = join(temp, 'report.json')
  try {
    await mkdir(join(capture, 'dekamarkt'), { recursive: true })
    await writeFile(join(capture, 'dekamarkt', 'fictional-dekamarkt-offers.html'), dekaHtml)
    await writeFile(join(capture, 'manifest.json'), JSON.stringify({
      sourceCount: 1, results: [{
        ...source('dekamarkt', 'offers', dekaHtml), success: true,
        finalUrl: 'https://www.dekamarkt.nl/aanbiedingen',
      }],
    }))
    const command = [ '--experimental-strip-types', new URL('../scripts/retailer-snapshot-selector-proposals.mjs', import.meta.url).pathname,
      '--out', out, capture ]
    const one = spawnSync(process.execPath, command, { encoding: 'utf8', timeout: 15000 })
    assert.equal(one.status, 0, one.stderr)
    assert.equal((await stat(out)).mode & 0o777, 0o600)
    const report = JSON.parse(await readFile(out, 'utf8'))
    assert.equal(report.legalAccessMustBeVerifiedSeparately, true)
    assert.equal(report.selectorSets[0].embeddedSignals.nuxtDataScriptPresent, true)
    const two = spawnSync(process.execPath, command, { encoding: 'utf8', timeout: 15000 })
    assert.notEqual(two.status, 0, 'existing report may not be overwritten')
    const alias = join(temp, 'capture-symlink')
    await symlink(capture, alias)
    await assert.rejects(proposeFromM1CaptureDirectory(alias), /symlink path components not allowed/)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('legacy M1 selector proposals refuse leading UTF-8 BOM and embedded NUL even with matching SHA', () => {
  for(const html of ['\uFEFF'+plusHtml,plusHtml+'\u0000']) {
    assert.throws(()=>proposeRetailerSelectors(source('plus','catalog',html),html),
      /Offline selector review refused/)
  }
  assert.equal(proposeRetailerSelectors(source('plus','catalog',plusHtml),plusHtml)
    .publicationAllowed,false)
})

test('legacy captured-source directory refuses invalid UTF-8 with a recomputed SHA manifest', async () => {
  const dir=await mkdtemp(join(tmpdir(),'supa-legacy-byte-'))
  try {
    await mkdir(join(dir,'plus'))
    const path=join(dir,'plus','fictional-plus-catalog.html')
    const base=Buffer.from(plusHtml)
    for(const bytes of [
      Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),base]),
      Buffer.concat([base,Buffer.from([0])]),
      Buffer.concat([base,Buffer.from([0xc3,0x28])]),
    ]) {
      await writeFile(path,bytes)
      const record={...source('plus','catalog',plusHtml),success:true,
        finalUrl:'https://www.plus.nl/producten',sha256:hash(bytes)}
      await writeFile(join(dir,'manifest.json'),JSON.stringify({
        sourceCount:1,results:[record],
      }))
      await assert.rejects(proposeFromM1CaptureDirectory(dir),/BOM|encoding|UTF-8/i)
    }
    await writeFile(path,base)
    const record={...source('plus','catalog',plusHtml),success:true,
      finalUrl:'https://www.plus.nl/producten'}
    await writeFile(join(dir,'manifest.json'),JSON.stringify({
      sourceCount:1,results:[record],
    }))
    const allowed=await proposeFromM1CaptureDirectory(dir)
    assert.equal(allowed.analyzedSources,1)
    assert.equal(allowed.productionEnabled,false)
  } finally { await rm(dir,{recursive:true,force:true}) }
})

test('historical M1 import refuses hardlinked HTML or manifest inode aliases', async () => {
  const { link, unlink } = await import('node:fs/promises')
  const root=await mkdtemp(join(tmpdir(),'supa-m1-hardlink-'))
  try {
    const dir=join(root,'capture')
    await mkdir(join(dir,'plus'),{recursive:true})
    const htmlFile=join(dir,'plus','fictional-plus-catalog.html')
    const manifestFile=join(dir,'manifest.json')
    const html=plusHtml
    const record={...source('plus','catalog',html),success:true,
      finalUrl:'https://www.plus.nl/producten'}
    await writeFile(htmlFile,html)
    await writeFile(manifestFile,JSON.stringify({sourceCount:1,results:[record]}))
    const baseline=await proposeFromM1CaptureDirectory(dir)
    assert.equal(baseline.selectorSets.length,1)
    assert.equal(baseline.productionEnabled,false)
    const htmlAlias=join(root,'html-alias')
    await link(htmlFile,htmlAlias)
    await assert.rejects(proposeFromM1CaptureDirectory(dir),/unsafe snapshot inode/)
    await unlink(htmlAlias)
    const manifestAlias=join(root,'manifest-alias')
    await link(manifestFile,manifestAlias)
    await assert.rejects(proposeFromM1CaptureDirectory(dir),/invalid manifest JSON or file/)
    await unlink(manifestAlias)
    assert.equal((await proposeFromM1CaptureDirectory(dir)).analyzedSources,1)
  } finally {await rm(root,{recursive:true,force:true})}
})

test('M1 imported source refuses symbolic HTML file with a valid-looking hash', async () => {
  const dir=await mkdtemp(join(tmpdir(),'supa-m1-symlink-'))
  try {
    await mkdir(join(dir,'plus'))
    const real=join(dir,'actual.html')
    const alias=join(dir,'plus','fictional-plus-catalog.html')
    await writeFile(real,plusHtml)
    await symlink(real,alias)
    await writeFile(join(dir,'manifest.json'),JSON.stringify({
      sourceCount:1,results:[{...source('plus','catalog',plusHtml),
        success:true,finalUrl:'https://www.plus.nl/producten'}],
    }))
    await assert.rejects(proposeFromM1CaptureDirectory(dir),/symlink path components not allowed/)
  } finally {await rm(dir,{recursive:true,force:true})}
})

test('pinned M1 manifest refuses duplicate or Unicode-aliased source identity keys', async () => {
  const dir=await mkdtemp(join(tmpdir(),'supa-m1-duplicate-provenance-'))
  try {
    await mkdir(join(dir,'plus'))
    await writeFile(join(dir,'plus','fictional-plus-catalog.html'),plusHtml)
    const manifest=join(dir,'manifest.json')
    const data={sourceCount:1,results:[{
      ...source('plus','catalog',plusHtml),success:true,
      finalUrl:'https://www.plus.nl/producten',
    }]}
    const valid=JSON.stringify(data)
    assert.equal((await proposeAfter(valid)).analyzedSources,1)
    const suspicious=[
      valid.replace('"sourceCount":1','"sourceCount":1,"sourceCount":1'),
      valid.replace('"sourceCount":1','"sourceCount":1,"\\u0073ourceCount":1'),
      valid.replace('"sha256":"','"sha256":"'+ '0'.repeat(64)+'","sha256":"'),
      valid.replace('"requestedUrl":"','"requestedUrl":"https://attacker.invalid","requestedUrl":"'),
    ]
    for (const raw of suspicious) {
      await writeFile(manifest,raw)
      await assert.rejects(proposeFromM1CaptureDirectory(dir),
        /Offline selector review refused:/)
    }
    await writeFile(manifest,valid)
    assert.equal((await proposeFromM1CaptureDirectory(dir)).analyzedSources,1)
    async function proposeAfter(raw) {
      await writeFile(manifest,raw)
      return proposeFromM1CaptureDirectory(dir)
    }
  } finally {await rm(dir,{recursive:true,force:true})}
})

test('legacy M1 source review refuses live HTML no-store, charset drift and page redirects', () => {
  const markup = [
    '<article class="product-card">SYNTHETIC</article>',
    '<a href="/product/synthetic-1">SYNTHETIC</a>',
  ].join('')
  const html=meta=>'<html><head>'+meta+'</head><body>'+markup+'</body></html>'
  for (const meta of [
    '<meta http-equiv="Cache-Control" content="no-store">',
    '<meta charset="windows-1252">',
    '<meta http-equiv="Content-Type" content="text/html; charset=latin1">',
    '<meta http-equiv="refresh" content="0; URL=/redirect">',
  ]) {
    const sourceRecord=source('plus','catalog',html(meta))
    assert.throws(()=>proposeRetailerSelectors(sourceRecord,html(meta)),
      /source directives prohibit selector review/)
  }
  const inert='<template><meta charset="windows-1252"></template>'
  const valid=html(inert+'<meta charset="UTF-8">')
  const report=proposeRetailerSelectors(source('plus','catalog',valid),valid)
  assert.equal(report.readyForScraping,false)
  assert.ok(report.proposedSelectors.some(row=>row.selector==='article.product-card'))
})

test('historical source provenance rejects redirects, encoded separators and URL normalization aliases', () => {
  const valid=source('plus','catalog',plusHtml)
  const explicit={...valid,finalUrl:valid.requestedUrl}
  assert.equal(proposeRetailerSelectors(explicit,plusHtml).readyForScraping,false)
  for(const mutate of [
    x=>{x.finalUrl='https://www.plus.nl/aanbiedingen'},
    x=>{x.requestedUrl='https://www.plus.nl/producten/%2fsecret'},
    x=>{x.requestedUrl='https://www.plus.nl:443/producten'},
    x=>{x.requestedUrl='https://www.plus.nl/producten/../login'},
    x=>{x.requestedUrl='https://www.plus.nl/producten/%252fsecret'},
  ]) {
    const candidate={...valid}
    mutate(candidate)
    assert.throws(()=>proposeRetailerSelectors(candidate,plusHtml),
      /Offline selector review refused:/)
  }
})

test('legacy capture review ignores foreign JSON-LD vocabularies as Schema.org proof',()=>{
  const cases=[
    {'@context':'https://foreign.invalid/','@type':'Product',name:'PRIVATE'},
    {'@context':['https://schema.org/','https://foreign.invalid/'],
      '@type':'Product',offers:{'@type':'Offer',price:77}},
    {'@context':{'@vocab':'https://foreign.invalid/'},
      '@type':'Product',price:77},
  ]
  for(const data of cases) {
    const html='<html><body><script type="application/ld+json">'+
      JSON.stringify(data)+'</script></body></html>'
    const report=proposeRetailerSelectors(source('plus','catalog',html),html)
    assert.deepEqual(report.embeddedSignals.jsonLdTypes,[])
    assert.equal(report.currentPricesExtracted,false)
    assert.equal(report.readyForScraping,false)
  }
})
test('legacy source review preserves valid inherited Schema.org graph types without product data',()=>{
  const html='<html><body><script type="application/ld+json">'+
    JSON.stringify({'@context':'https://schema.org/',
      '@graph':[{'@type':'Product',name:'PRIVATE',offers:{
        '@type':'Offer',price:99.99}}]})+
    '</script></body></html>'
  const result=proposeRetailerSelectors(source('plus','catalog',html),html)
  assert.deepEqual(result.embeddedSignals.jsonLdTypes,['Offer','Product'])
  assert.ok(result.embeddedSignals.jsonLdKeys.includes('price'))
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|99.99/)
})
test('duplicate JSON-LD keys cannot create a source signal in the legacy M1 snapshot review',()=>{
  const json='{"@context":"https://schema.org","@type":"Product","@type":"Offer"}'
  const html='<html><body><script type="application/ld+json">'+json+
    '</script></body></html>'
  const result=proposeRetailerSelectors(source('plus','catalog',html),html)
  assert.equal(result.embeddedSignals.invalidJsonLdCount,1)
  assert.deepEqual(result.embeddedSignals.jsonLdTypes,[])
  assert.equal(result.readyForScraping,false)
})

test('M1 legacy capture review reuses observed microdata selectors from the strict offline engine',()=>{
  for(const [retailer,kind,url] of [
    ['plus','catalog','https://www.plus.nl/producten'],
    ['dekamarkt','offers','https://www.dekamarkt.nl/aanbiedingen']]) {
    const html='<html><head><meta charset="UTF-8"></head><body>'+
      '<article itemscope itemtype="https://schema.org/Product">'+
      '<span itemprop="name">PRIVATE_LEGACY_PRODUCT</span>'+
      '<meta itemprop="price" content="99.99">'+
      '<a href="'+(retailer==='plus'?'/product/':'/producten/')+
      'PRIVATE_SKU_321">DO NOT PUBLISH</a></article></body></html>'
    const identity=source(retailer,kind,html)
    identity.requestedUrl=url
    const report=proposeRetailerSelectors(identity,html)
    for(const selector of [
      'article[itemtype="https://schema.org/Product"]',
      'span[itemprop="name"]','meta[itemprop="price"]']) {
      assert.ok(report.proposedSelectors.some(row=>row.selector===selector),
        'missing source-observed review hint '+selector)
    }
    assert.ok(report.possibleFieldSelectors.price.some(x=>
      x.selector==='meta[itemprop="price"]'))
    assert.equal(report.readyForScraping,false)
    assert.equal(report.currentPricesExtracted,false)
    assert.equal(report.sourcePermissionVerified,false)
    assert.doesNotMatch(JSON.stringify(report),
      /PRIVATE_LEGACY_PRODUCT|PRIVATE_SKU_321|99.99|DO NOT PUBLISH/)
  }
})
