import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureAndArchiveApprovedSourceReview } from '../scripts/retailer-approved-price-archive-run.mjs'

// All source pages, rights, product names and HTTP headers are SYNTHETIC.
// These tests do NOT grant retailer permissions or make network requests.
const urls = {
  plus: 'https://www.plus.nl/product/fictional-771',
  dekamarkt: 'https://www.dekamarkt.nl/producten/fictional-992',
}
const gate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus','dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{kind: 'written_permission',
      url: 'https://example.test/SYNTHETIC-TEST-NO-REAL-RETAILER-GRANT',
      finding: 'Synthetic in-memory contract only: NOT SOURCE RIGHTS'}],
  })),
}
const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('base64')
function mock(store) {
  const product = {
    '@context': 'https://schema.org', '@type': 'Product',
    sku: store === 'plus' ? '771' : '992', url: urls[store],
    name: 'Fictional milk €',
    weight: {value: '500 g'},
    offers: { '@type': 'Offer', price: '2.49', priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock' },
  }
  return '<!doctype html><html><head><script type="application/ld+json">' +
    JSON.stringify(product) + '</script></head><body>' +
    '<div class="product-card"><span class="price-value">SYNTHETIC ONLY</span></div>' +
    '</body></html>'
}
function configured(store, body, reportedDigest, fetchTap) {
  return {
    source: {supermarket:store,kind:'product',url:urls[store]},
    capturedAt: new Date(Date.now() - 30_000).toISOString(),
    permissionGate: gate,
    grant: {supermarket:store,kind:'product',sourceUrl:urls[store],
      reviewed:true,termsReviewed:true,robotsReviewed:true,noAntiBotBypass:true},
    fetchFn: async (url,opts) => {
      fetchTap(url,opts)
      return new Response(body,{status:200,headers:{
        'content-type':'text/html; charset=utf-8',
        'content-length':String(Buffer.byteLength(body)),
        'content-digest':reportedDigest,
      }})
    },
  }
}
async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(),'supa-digest-archive-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  return dir
}

test('M1 PLUS and Deka SHA-256/SHA-512 source attestations bind one fetch to a private 0600 price + selector archive',async t=>{
  for(const store of ['plus','dekamarkt']) {
    const dir=await temporary(t), file=join(dir,'review.json'), html=mock(store)
    const sha256=digest('sha256',html), sha512=digest('sha512',html)
    let invocations=0
    const headers='sha-256=:'+sha256+':, sha-512=:'+sha512+':'
    const result=await captureAndArchiveApprovedSourceReview(
      configured(store,html,headers,(url,opts)=>{
        invocations++
        assert.equal(url,urls[store])
        assert.equal(opts.redirect,'error')
        assert.equal(opts.credentials,'omit')
        assert.equal(opts.headers['accept-encoding'],'identity')
        assert.equal(opts.headers['want-content-digest'],'sha-256=10, sha-512=9')
      }),file)
    assert.equal(invocations,1)
    assert.equal(result.actualTransportInvocations,1)
    assert.equal(result.candidateCount,1)
    assert.ok(result.selectorCount>0)
    assert.equal(result.published,false)
    assert.equal(result.productionEnabled,false)
    assert.doesNotMatch(JSON.stringify(result),/771|992|milk|2\\.49|fictional/)
    const record=JSON.parse(await readFile(file,'utf8'))
    assert.equal(record.schemaVersion,2)
    assert.equal(record.source.url,urls[store])
    assert.equal(record.source.sha256,createHash('sha256').update(html).digest('hex'))
    assert.equal(record.priceReview.observation.currentPriceCents,249)
    assert.ok(record.selectorReview.proposals.some(row=>row.field==='product'))
    assert.equal(record.selectorReview.approvedSelectors,0)
    assert.equal(record.published,false)
    assert.equal((await stat(file)).mode&0o777,0o600)
    assert.deepEqual(await readdir(dir),['review.json'])
  }
})

test('corrupt independent SHA-512 source evidence is refused without partial private output, price publication or retries',async t=>{
  for(const store of ['plus','dekamarkt']) {
    const dir=await temporary(t), html=mock(store), file=join(dir,'must-not-write.json')
    const badSha512=digest('sha512',html+'CORRUPTED')
    let calls=0
    await assert.rejects(captureAndArchiveApprovedSourceReview(
      configured(store,html,
        'sha-256=:'+digest('sha256',html)+':, sha-512=:'+badSha512+':',
        ()=>{calls++}),file),
      /Retailer Content-Digest mismatch/)
    assert.equal(calls,1)
    assert.deepEqual(await readdir(dir),[])
  }
})
