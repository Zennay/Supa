import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  inspectCaptureDirectory,
  inspectHtml,
} from '../scripts/m1-inspect-captures.mjs'

test('inspects generic structured data without source selectors', () => {
  const html = `<!doctype html>
  <html>
    <head>
      <title>Example product</title>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"Product","name":"Milk","offers":{"@type":"Offer","price":"1.29"}}
      </script>
      <script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script>
    </head>
    <body></body>
  </html>`

  const result = inspectHtml(html)
  assert.equal(result.title, 'Example product')
  assert.equal(result.hasNextData, true)
  assert.equal(result.jsonLd.length, 1)
  assert.deepEqual(result.jsonLd[0].type, ['Product'])
  assert.ok(result.jsonLd[0].keys.includes('offers'))
  assert.deepEqual(result.applicationJsonScripts, [
    { id: '__NEXT_DATA__', bytes: 26 },
  ])
})

test('verifies captured HTML against manifest SHA-256', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'supa-m1-inspect-'))
  const supermarketDir = path.join(root, 'ah')
  await mkdir(supermarketDir, { recursive: true })

  const html = '<html><head><title>Milk</title></head><body></body></html>'
  const digest = createHash('sha256').update(html).digest('hex')
  await writeFile(
    path.join(supermarketDir, 'ah-product.html'),
    html,
    'utf8',
  )

  await writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      milestone: 'M1 Data Feasibility',
      bounded: true,
      startedAt: '2026-10-04T00:00:00.000Z',
      completedAt: '2026-10-04T00:01:00.000Z',
      sourceCount: 1,
      successCount: 1,
      failureCount: 0,
      results: [
        {
          id: 'ah-product',
          supermarket: 'ah',
          kind: 'product',
          requestedUrl: 'https://www.ah.nl/producten/product/example',
          finalUrl: 'https://www.ah.nl/producten/product/example',
          capturedAt: '2026-10-04T00:00:30.000Z',
          sha256: digest,
          success: true,
        },
      ],
    }),
    'utf8',
  )

  const report = await inspectCaptureDirectory(root)
  assert.equal(report.integrityVerifiedCount, 1)
  assert.equal(report.sources[0].integrity, 'verified')
  assert.equal(report.sources[0].html.title, 'Milk')
  assert.equal(report.sources[0].schemaOrgProduct.type, 'abstain')
})

test('fails loudly on capture hash mismatch', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'supa-m1-inspect-bad-'))
  const supermarketDir = path.join(root, 'plus')
  await mkdir(supermarketDir, { recursive: true })
  await writeFile(
    path.join(supermarketDir, 'plus-product.html'),
    '<html></html>',
    'utf8',
  )

  await writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      milestone: 'M1 Data Feasibility',
      bounded: true,
      sourceCount: 1,
      results: [
        {
          id: 'plus-product',
          supermarket: 'plus',
          kind: 'product',
          requestedUrl: 'https://www.plus.nl/product/example',
          capturedAt: '2026-10-04T00:00:00.000Z',
          sha256: 'a'.repeat(64),
          success: true,
        },
      ],
    }),
    'utf8',
  )

  await assert.rejects(
    () => inspectCaptureDirectory(root),
    /integrity mismatch/,
  )
})


test('rejects unsafe source ids before resolving capture file paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'supa-m1-inspect-id-'))

  await writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      milestone: 'M1 Data Feasibility',
      bounded: true,
      sourceCount: 1,
      results: [
        {
          id: '../outside',
          supermarket: 'plus',
          kind: 'product',
          success: true,
          sha256: 'a'.repeat(64),
        },
      ],
    }),
    'utf8',
  )

  await assert.rejects(
    () => inspectCaptureDirectory(root),
    /Unsafe capture source id/,
  )
})

test('rejects unsafe supermarket path segments before reading HTML', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'supa-m1-inspect-store-'))

  await writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      milestone: 'M1 Data Feasibility',
      bounded: true,
      sourceCount: 1,
      results: [
        {
          id: 'plus-product',
          supermarket: '..',
          kind: 'product',
          success: true,
          sha256: 'a'.repeat(64),
        },
      ],
    }),
    'utf8',
  )

  await assert.rejects(
    () => inspectCaptureDirectory(root),
    /Unsafe capture supermarket path segment/,
  )
})

test('M1 source inspection accepts only real DOM JSON-LD/Nuxt scripts, not inert or forged script text',()=>{
  const actual='<script type="application/ld+json&#59;charset=UTF-8">{"@context":"https://schema.org","@type":"Product","name":"SYNTHETIC"}</script>'
  const inert='<template><script type="application/ld+json">{"@type":"Offer","price":0.01}</script></template>'
  const spoof='<div data-copy="<script type=\'application/ld+json\'>{&quot;@type&quot;:&quot;Offer&quot;}</script>"></div>'
  const nested='<script id="__NEXT&#95;DATA__" type="application/json">{"props":{}}</script>'
  const html='<!doctype html><body>'+inert+'<!--<script type="application/ld+json">{"@type":"Offer"}</script>-->'+spoof+actual+nested+'</body>'
  const report=inspectHtml(html)
  assert.deepEqual(report.jsonLd.map(x=>x.type),[['Product']])
  assert.equal(report.hasNextData,true)
  assert.deepEqual(report.applicationJsonScripts,[{id:'__NEXT_DATA__',bytes:12}])
})

test('M1 original inspector marks duplicate JSON keys, malformed data MIME and external JSON scripts invalid',()=>{
  const html='<script type="application/ld+json">{"@context":"https://schema.org","@type":"Offer","@type":"Product"}</script>'+
    '<script type="application/ld+json; charset=latin1">{"@type":"Offer"}</script>'+
    '<script type="application/ld+json" src="https://outside.invalid/json">{"@type":"Product"}</script>'
  const report=inspectHtml(html)
  assert.ok(report.jsonLd.length>=2)
  assert.ok(report.jsonLd.every(x=>x.parseError===true))
  assert.equal(report.hasNextData,false)
})

test('M1 captured HTML inspection refuses invalid original UTF-8 even if manifest hashes decoded replacement text',async()=>{
  const {rm}=await import('node:fs/promises')
  const root=await mkdtemp(path.join(os.tmpdir(),'supa-m1-byte-provenance-'))
  try {
    await mkdir(path.join(root,'plus'))
    for(const raw of [Buffer.from('<html><head><title>OK</title></head><body>\ufffd</body></html>','utf8'),Buffer.from([0xef,0xbb,0xbf,...Buffer.from('<html><title>OK</title></html>')])]) {
      const isBOM=raw[0]===0xef
      const bytes=isBOM?raw:Buffer.concat([Buffer.from('<html><head><title>OK</title></head><body>'),Buffer.from([0xc3,0x28]),Buffer.from('</body></html>')])
      await writeFile(path.join(root,'plus','plus-catalog.html'),bytes)
      const fakeDigest=createHash('sha256').update(bytes.toString('utf8')).digest('hex')
      const originalDigest=createHash('sha256').update(bytes).digest('hex')
      for(const digest of [fakeDigest,originalDigest]) {
        await writeFile(path.join(root,'manifest.json'),JSON.stringify({milestone:'M1 Data Feasibility',bounded:true,sourceCount:1,results:[{id:'plus-catalog',supermarket:'plus',kind:'catalog',requestedUrl:'https://www.plus.nl/producten',finalUrl:'https://www.plus.nl/producten',capturedAt:'2026-10-04T00:00:00.000Z',sha256:digest,success:true}]}))
        await assert.rejects(inspectCaptureDirectory(root),/UTF-8|BOM|encoding|integrity|source bytes/i)
      }
    }
  } finally {await rm(root,{recursive:true,force:true})}
})

test('M1 captured manifest duplicate identities cannot be laundered by JSON last-key-wins',async()=>{
  const {rm}=await import('node:fs/promises')
  const root=await mkdtemp(path.join(os.tmpdir(),'supa-m1-duplicate-manifest-'))
  try {
    await writeFile(path.join(root,'manifest.json'),'{"milestone":"INVALID","milestone":"M1 Data Feasibility","bounded":true,"sourceCount":0,"results":[]}')
    await assert.rejects(inspectCaptureDirectory(root),/ambiguous|duplicate|manifest|JSON/i)
  } finally {await rm(root,{recursive:true,force:true})}
})

test('M1 capture inspection refuses unscoped fake Product price while retaining official-context source evidence',async()=>{
  const {rm}=await import('node:fs/promises')
  const root=await mkdtemp(path.join(os.tmpdir(),'supa-m1-schema-origin-'))
  try {
    await mkdir(path.join(root,'plus'))
    const product={'@type':'Product',name:'SYNTHETIC',sku:'TEST',offers:{'@type':'Offer',price:'1.99',priceCurrency:'EUR',availability:'https://schema.org/InStock'}}
    for(const official of [false,true]) {
      const body=official?{'@context':'https://schema.org',...product}:product
      const html='<script type="application/ld+json">'+JSON.stringify(body)+'</script>'
      await writeFile(path.join(root,'plus','plus-product.html'),html)
      await writeFile(path.join(root,'manifest.json'),JSON.stringify({milestone:'M1 Data Feasibility',bounded:true,sourceCount:1,results:[{id:'plus-product',supermarket:'plus',kind:'product',requestedUrl:'https://www.plus.nl/product/test',finalUrl:'https://www.plus.nl/product/test',capturedAt:'2026-10-04T00:00:00.000Z',sha256:createHash('sha256').update(html).digest('hex'),success:true}]}))
      const review=await inspectCaptureDirectory(root)
      assert.equal(review.sources[0].schemaOrgProduct.type,official?'observation':'abstain')
      if(official)assert.equal(review.sources[0].schemaOrgProduct.observation.currentPriceCents,199)
    }
  } finally {await rm(root,{recursive:true,force:true})}
})

test('M1 inspection binds archived product bytes to one verified retailer URL and DOM canonical',async()=>{
  const {rm}=await import('node:fs/promises')
  const root=await mkdtemp(path.join(os.tmpdir(),'supa-m1-real-identity-'))
  try {
    await mkdir(path.join(root,'plus'))
    const goodUrl='https://www.plus.nl/product/test'
    const write=async(html,finalUrl=goodUrl)=>{
      await writeFile(path.join(root,'plus','plus-product.html'),html)
      await writeFile(path.join(root,'manifest.json'),JSON.stringify({milestone:'M1 Data Feasibility',bounded:true,sourceCount:1,results:[{id:'plus-product',supermarket:'plus',kind:'product',requestedUrl:goodUrl,finalUrl,capturedAt:'2026-10-04T00:00:00.000Z',sha256:createHash('sha256').update(html).digest('hex'),success:true}]}))
    }
    const product='<script type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org','@type':'Product',name:'SYNTHETIC',sku:'TEST',offers:{'@type':'Offer',price:'1.99',priceCurrency:'EUR'}})+'</script>'
    await write('<html><link rel="canonical" href="'+goodUrl+'">'+product+'</html>')
    assert.equal((await inspectCaptureDirectory(root)).sources[0].integrity,'verified')
    for(const wrong of ['https://www.plus.nl/product/other','https://www.dekamarkt.nl/producten/other']){
      await write('<html>'+product+'</html>',wrong)
      await assert.rejects(inspectCaptureDirectory(root),/origin|URL|redirect|source|identity/i)
    }
    for(const declaration of ['<link rel="canonical" href="https://www.plus.nl/product/other">','<base href="https://other.invalid/">']){
      await write('<html>'+declaration+product+'</html>')
      await assert.rejects(inspectCaptureDirectory(root),/canonical|base|origin|source|identity/i)
    }
  } finally {await rm(root,{recursive:true,force:true})}
})
