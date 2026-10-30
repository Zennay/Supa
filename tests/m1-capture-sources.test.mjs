import assert from 'node:assert/strict'
import test from 'node:test'

import { SOURCES, validateSources, assertArchivableRetailerHtml, readBoundedRetailerUtf8Response } from '../scripts/m1-capture-sources.mjs'

test('M1 capture source set is bounded to two supermarkets and three page kinds', () => {
  assert.equal(SOURCES.length, 6)
  assert.deepEqual(
    [...new Set(SOURCES.map((source) => source.supermarket))].sort(),
    ['dekamarkt', 'plus'],
  )

  for (const supermarket of ['dekamarkt', 'plus']) {
    assert.deepEqual(
      SOURCES
        .filter((source) => source.supermarket === supermarket)
        .map((source) => source.kind)
        .sort(),
      ['catalog', 'offers', 'product'],
    )
  }

  assert.equal(validateSources(), true)
})

test('M1 capture rejects supermarkets outside the current technical pair', () => {
  assert.throws(
    () =>
      validateSources([
        {
          id: 'historical-ah-source',
          supermarket: 'ah',
          kind: 'product',
          url: 'https://www.ah.nl/producten',
        },
      ]),
    /Unsupported supermarket/,
  )
})

test('M1 capture rejects a URL whose host does not match its supermarket', () => {
  assert.throws(
    () =>
      validateSources([
        {
          id: 'mislabeled-source',
          supermarket: 'dekamarkt',
          kind: 'product',
          url: 'https://www.plus.nl/producten',
        },
      ]),
    /does not match supermarket allowlist/,
  )
})

test('M1 capture rejects non-HTTPS supermarket URLs', () => {
  assert.throws(
    () =>
      validateSources([
        {
          id: 'insecure-source',
          supermarket: 'plus',
          kind: 'offers',
          url: 'http://www.plus.nl/aanbiedingen',
        },
      ]),
    /does not match supermarket allowlist/,
  )
})

test('M1 capture rejects unsupported source kinds', () => {
  assert.throws(
    () =>
      validateSources([
        {
          id: 'wrong-kind',
          supermarket: 'dekamarkt',
          kind: 'search',
          url: 'https://www.dekamarkt.nl/producten/zuivel-kaas/melk-karnemelk',
        },
      ]),
    /Unsupported source kind/,
  )
})


test('M1 capture rejects unsafe source ids before they can become file names', () => {
  assert.throws(
    () =>
      validateSources([
        {
          id: '../plus-product',
          supermarket: 'plus',
          kind: 'product',
          url: 'https://www.plus.nl/producten',
        },
      ]),
    /Invalid or duplicate source id/,
  )
})

test('M1 capture rejects non-default HTTPS ports', () => {
  assert.throws(
    () =>
      validateSources([
        {
          id: 'plus-alt-port',
          supermarket: 'plus',
          kind: 'catalog',
          url: 'https://www.plus.nl:444/producten',
        },
      ]),
    /does not match supermarket allowlist/,
  )
})

test('M1 capture rejects credential-bearing allowlisted URLs', () => {
  assert.throws(
    () =>
      validateSources([
        {
          id: 'plus-credential-url',
          supermarket: 'plus',
          kind: 'catalog',
          url: 'https://user:secret@www.plus.nl/producten',
        },
      ]),
    /does not match supermarket allowlist/,
  )
})

test('M1 capture refuses mislabeled paths, encoded separators and query-bearing source URLs', () => {
  const invalid = [
    ['plus','product','https://www.plus.nl/producten'],
    ['plus','catalog','https://www.plus.nl/product/fictional'],
    ['dekamarkt','offers','https://www.dekamarkt.nl/admin'],
    ['dekamarkt','catalog','https://www.dekamarkt.nl/producten/%2fcheckout'],
    ['plus','offers','https://www.plus.nl/aanbiedingen?customer=fictional'],
    ['dekamarkt','product','https://www.dekamarkt.nl/producten/sku#private'],
  ]
  for (const [supermarket,kind,url] of invalid)
    assert.throws(()=>validateSources([{id:'synthetic-source',supermarket,kind,url}]),
      /does not match supermarket allowlist/,url)
})

test('legacy M1 transport rejects redirects before following and writes only after status/content checks',async()=>{
  const {readFile}=await import('node:fs/promises')
  const code=await readFile(new URL('../scripts/m1-capture-sources.mjs',import.meta.url),'utf8')
  assert.match(code,/redirect:\s*'error'/)
  assert.doesNotMatch(code,/redirect:\s*'follow'/)
  const status=code.indexOf('if (!response.ok) throw new Error')
  const content=code.indexOf('if (!isHtmlContentType(contentType))')
  const store=code.indexOf('await writeFile(path.join(dir,')
  assert.ok(status>0 && content>status && store>content,
    'denied/non-HTML source cannot be archived before validation')
})

test('only bounded UTF-8 archive-permitted HTML is retained as a source fixture',()=>{
 const html='<html><head><meta charset="utf-8"></head><body><article class="product-card">Synthetic only</article></body></html>'
 assert.equal(assertArchivableRetailerHtml(html,'text/html;charset=utf-8'),Buffer.byteLength(html))
 assert.equal(assertArchivableRetailerHtml(html,'application/xhtml+xml'),Buffer.byteLength(html))
 for(const [markup,type] of [
  [html,'text/html; charset=windows-1252'],
  [html,'text/html; charset=utf-8; charset=utf-8'],
  [html,'application/json'],
  ['\uFEFF'+html,'text/html'],
  [html+'\0','text/html'],
  [html.replace('<meta charset="utf-8">','<meta charset="windows-1252">'),'text/html'],
  [html.replace('<meta charset="utf-8">','<meta name="robots" content="noarchive">'),'text/html'],
  [html.replace('<meta charset="utf-8">','<meta http-equiv="cache-control" content="no-store">'),'text/html'],
  [html.replace('<meta charset="utf-8">','<meta http-equiv="refresh" content="0;url=/other">'),'text/html'],
 ])assert.throws(()=>assertArchivableRetailerHtml(markup,type),/Unacceptable|charset|archival/,type)
})

test('M1 capture uses lossless UTF-8 decoding and checks archive opt-outs before persistent write',async()=>{
 const {readFile}=await import('node:fs/promises')
 const code=await readFile(new URL('../scripts/m1-capture-sources.mjs',import.meta.url),'utf8')
 assert.match(code,/new TextDecoder\('utf-8', \{ fatal: true \}\)\.decode\(raw\)/)
 assert.match(code,/assertArchivableRetailerHtml\(body, contentType\)/)
 const verified=code.indexOf('const bytes = assertArchivableRetailerHtml(body, contentType)')
 const write=code.indexOf('await writeFile(path.join(dir,')
 assert.ok(verified>0 && write>verified)
})

test('bounded retailer stream retains exact multi-chunk UTF-8 bytes without a content-length',async()=>{
 const html='<html><body>synthetic café</body></html>'
 const utf8=new TextEncoder().encode(html)
 const response=new Response(new ReadableStream({start(c){c.enqueue(utf8.subarray(0,21));c.enqueue(utf8.subarray(21));c.close()}}),{headers:{'content-type':'text/html'}})
 const read=await readBoundedRetailerUtf8Response(response)
 assert.equal(read,html)
 assert.equal(assertArchivableRetailerHtml(read,'text/html'),utf8.length)
})

test('stream aborts oversized bytes before retaining, even with no declared content length',async()=>{
 let canceled=false
 const response=new Response(new ReadableStream({
  start(c){c.enqueue(new Uint8Array(5*1024*1024));c.enqueue(new Uint8Array(1))},
  cancel(){canceled=true},
 }),{headers:{'content-type':'text/html'}})
 await assert.rejects(readBoundedRetailerUtf8Response(response),/exceeded cap/)
 assert.equal(canceled,true)
})

test('stream rejects malformed UTF-8, BOM and missing response body',async()=>{
 for(const bytes of [new Uint8Array([0xc3,0x28]),new Uint8Array([0xef,0xbb,0xbf,65])]){
  await assert.rejects(readBoundedRetailerUtf8Response(new Response(bytes)),
   /encoded|BOM|valid|UTF|input/,Array.from(bytes).join(','))
 }
 await assert.rejects(readBoundedRetailerUtf8Response(new Response(null)),/Missing streamed/)
})
