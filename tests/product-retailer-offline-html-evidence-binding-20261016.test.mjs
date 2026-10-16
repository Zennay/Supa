import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { bindPrivateReviewedHtmlEvidence } from '../scripts/retailer-offline-html-evidence-binding.mjs'

async function fixture(filename) {
  return JSON.parse(await readFile(new URL('../fixtures/m1/' + filename, import.meta.url), 'utf8'))
}

function syntheticReviewedHtml(record) {
  // These are synthetic HTML/script envelopes around REAL historic M1
  // STRUCTURED adapter fixtures. They are NOT historic captured HTML bytes,
  // genuine third-party approval, legal rights or current prices.
  const reviewed = structuredClone(record)
  const scripts = []
  if (reviewed.jsonLd) scripts.push('<script type="application/ld+json">' +
    JSON.stringify(reviewed.jsonLd) + '</script>')
  if (reviewed.nuxtPayload) scripts.push('<script type="application/json" id="__NUXT_DATA__">' +
    JSON.stringify(reviewed.nuxtPayload) + '</script>')
  if (reviewed.jsonLdProduct) scripts.push('<script type="application/ld+json">' +
    JSON.stringify(reviewed.jsonLdProduct) + '</script>')
  const html = '<!doctype html><html><head>' + scripts.join('') + '</head><body></body></html>'
  const bytes = Buffer.byteLength(html, 'utf8')
  const sha256 = createHash('sha256').update(html, 'utf8').digest('hex')
  reviewed.source.sha256 = sha256
  if (reviewed.browserEvidence) reviewed.browserEvidence.renderedHtmlSha256 = sha256
  if (reviewed.captureEvidence) reviewed.captureEvidence.bytes = bytes
  const captured = {
    mode: 'authorized-one-page-capture-needs-review',
    source: {
      retailerId: reviewed.source.supermarket, kind: reviewed.source.kind,
      url: reviewed.source.url, capturedAt: reviewed.source.capturedAt, sha256,
    },
    bytes, html,
    permissionVerifiedForThisRequest: true, normalized: false,
    readyForIngestion: false, published: false,
  }
  return { captured, reviewed }
}

for (const filename of [
  'plus-rendered-product-halfvolle-melk.v1.json',
  'dekamarkt-product-halfvolle-melk.v1.json',
  'dekamarkt-catalog-melk.v1.json',
  'dekamarkt-offers.v1.json',
]) {
  test('offline HTML SHA+structured content binds to actual ' + filename + ' adapter without publication', async () => {
    const { captured, reviewed } = syntheticReviewedHtml(await fixture(filename))
    const result = bindPrivateReviewedHtmlEvidence(captured, reviewed)
    assert.equal(result.mode, 'private-offline-html-evidence-review')
    assert.equal(result.source.retailerId, reviewed.source.supermarket)
    assert.equal(result.source.sha256, captured.source.sha256)
    assert.equal(result.verifiedHtmlBytes, captured.bytes)
    assert.ok(result.normalizedObservationCount > 0)
    assert.equal(result.internalReviewedObservations.length, result.normalizedObservationCount)
    assert.equal(result.internalReviewedObservations[0].currency, 'EUR')
    assert.equal(result.internalReviewedObservations[0].provenance.sha256, captured.source.sha256)
    assert.equal(result.reviewRequired, true)
    assert.equal(result.rightsVerifiedForReuse, false)
    assert.equal(result.livePricesAvailable, false)
    assert.equal(result.publishable, false)
    assert.equal(result.productionEnabled, false)
    assert.equal(result.externalRequests, 0)
  })
}

test('changed raw HTML bytes, wrong digest or mismatched timestamps are refused', async () => {
  const { captured, reviewed } = syntheticReviewedHtml(
    await fixture('plus-rendered-product-halfvolle-melk.v1.json'))
  assert.throws(() => bindPrivateReviewedHtmlEvidence(
    { ...captured, html: captured.html + ' ' }, reviewed), /binding refused/)
  assert.throws(() => bindPrivateReviewedHtmlEvidence(
    { ...captured, bytes: captured.bytes + 1 }, reviewed), /binding refused/)
  assert.throws(() => bindPrivateReviewedHtmlEvidence(
    captured, { ...reviewed, source: { ...reviewed.source, capturedAt: '2026-10-05T18:08:57.837Z' } }),
  /binding refused/)
  assert.throws(() => bindPrivateReviewedHtmlEvidence(
    captured, { ...reviewed, source: { ...reviewed.source, sha256: 'a'.repeat(64) } }),
  /binding refused/)
})

test('JSON-LD product price and Deka Nuxt payload must be identical to captured script', async () => {
  const plus = syntheticReviewedHtml(await fixture('plus-rendered-product-halfvolle-melk.v1.json'))
  const changed = structuredClone(plus.reviewed)
  changed.jsonLd.offers.priceSpecification[0].price = 0.01
  assert.throws(() => bindPrivateReviewedHtmlEvidence(plus.captured, changed), /binding refused/)

  const deka = syntheticReviewedHtml(await fixture('dekamarkt-product-halfvolle-melk.v1.json'))
  const changedDeka = structuredClone(deka.reviewed)
  changedDeka.nuxtPayload[11] = 0.01
  assert.throws(() => bindPrivateReviewedHtmlEvidence(deka.captured, changedDeka), /binding refused/)
  changedDeka.nuxtPayload = deka.reviewed.nuxtPayload
  changedDeka.jsonLdProduct.name = 'Unverified changed product'
  assert.throws(() => bindPrivateReviewedHtmlEvidence(deka.captured, changedDeka), /binding refused/)
})

test('ambiguous duplicate JSON provenance keys cannot be laundered through parse', async () => {
  const plus = syntheticReviewedHtml(await fixture('plus-rendered-product-halfvolle-melk.v1.json'))
  const html = plus.captured.html.replace('"name":"Zuivelmeester Halfvolle melk"',
    '"name":"spoofed","n\\u0061me":"Zuivelmeester Halfvolle melk"')
  const sha256 = createHash('sha256').update(html, 'utf8').digest('hex')
  const captured = { ...plus.captured, html, bytes: Buffer.byteLength(html),
    source: { ...plus.captured.source, sha256 } }
  const record = structuredClone(plus.reviewed)
  record.source.sha256 = sha256
  record.browserEvidence.renderedHtmlSha256 = sha256
  assert.throws(() => bindPrivateReviewedHtmlEvidence(captured, record), /binding refused/)
})

test('no PLUS rendered card selector is silently accepted as price evidence', async () => {
  for (const filename of ['plus-rendered-catalog.v1.json', 'plus-rendered-offers.v1.json']) {
    const { captured, reviewed } = syntheticReviewedHtml(await fixture(filename))
    assert.throws(() => bindPrivateReviewedHtmlEvidence(captured, reviewed), /binding refused/)
  }
})

test('untrusted accessors, revoked Proxies, sparse nested data and fake approval cannot execute or publish', async () => {
  const plus = syntheticReviewedHtml(await fixture('plus-rendered-product-halfvolle-melk.v1.json'))
  let calls = 0
  const accessor = { ...plus.captured }
  Object.defineProperty(accessor, 'html', { get() { calls++; throw new Error('GETTER CALLED') } })
  assert.throws(() => bindPrivateReviewedHtmlEvidence(accessor, plus.reviewed), /binding refused/)
  assert.equal(calls, 0)
  const revoked = Proxy.revocable(plus.reviewed, {})
  revoked.revoke()
  assert.throws(() => bindPrivateReviewedHtmlEvidence(plus.captured, revoked.proxy), /binding refused/)
  assert.throws(() => bindPrivateReviewedHtmlEvidence(
    { ...plus.captured, permissionVerifiedForThisRequest: false }, plus.reviewed), /binding refused/)
  const sparse = structuredClone(plus.reviewed)
  sparse.jsonLd.offers.priceSpecification = new Array(1)
  assert.throws(() => bindPrivateReviewedHtmlEvidence(plus.captured, sparse), /binding refused/)
})

function runWithRehashedSyntheticHtml(original, changedHtml) {
  const record = structuredClone(original.reviewed)
  const sha256 = createHash('sha256').update(changedHtml, 'utf8').digest('hex')
  record.source.sha256 = sha256
  if (record.browserEvidence) record.browserEvidence.renderedHtmlSha256 = sha256
  if (record.captureEvidence) record.captureEvidence.bytes = Buffer.byteLength(changedHtml)
  const capture = {
    ...original.captured, html: changedHtml,
    bytes: Buffer.byteLength(changedHtml),
    source: { ...original.captured.source, sha256 },
  }
  return bindPrivateReviewedHtmlEvidence(capture, record)
}

test('data-type lookalike must not impersonate literal JSON-LD script attribute', async () => {
  const original = syntheticReviewedHtml(await fixture('plus-rendered-product-halfvolle-melk.v1.json'))
  const changedHtml = original.captured.html.replace(
    'type="application/ld+json"', 'data-type="application/ld+json"')
  assert.throws(() => runWithRehashedSyntheticHtml(original, changedHtml), /binding refused/)
})

test('data-id lookalike must not impersonate literal Nuxt script id', async () => {
  const original = syntheticReviewedHtml(await fixture('dekamarkt-product-halfvolle-melk.v1.json'))
  const changedHtml = original.captured.html.replace(
    'id="__NUXT_DATA__"', 'data-id="__NUXT_DATA__"')
  assert.throws(() => runWithRehashedSyntheticHtml(original, changedHtml), /binding refused/)
})

test('JSON-LD inside HTML comments or template is inert, not an observation', async () => {
  const original = syntheticReviewedHtml(await fixture('plus-rendered-product-halfvolle-melk.v1.json'))
  const script = /<script type="application\/ld\+json">[\s\S]*?<\/script>/.exec(original.captured.html)?.[0]
  assert.ok(script)
  for(const replacement of ['<!--' + script + '-->', '<template>' + script + '</template>']) {
    const changedHtml = original.captured.html.replace(script, replacement)
    assert.throws(() => runWithRehashedSyntheticHtml(original, changedHtml), /binding refused/)
  }
  assert.throws(() => runWithRehashedSyntheticHtml(
    original, original.captured.html + '<!-- unclosed'), /binding refused/)
})

test('script attribute values must never impersonate actual id or type attributes', async () => {
  const plus = syntheticReviewedHtml(await fixture('plus-rendered-product-halfvolle-melk.v1.json'))
  for (const attribute of [
    'data-note="type=' + "'application/ld+json'" + '"',
    'type="text/plain" type="application/ld+json"',
    'data-note="type=' + "'application/ld+json'" + '" type="text/plain"',
  ]) {
    const html = plus.captured.html.replace('type="application/ld+json"', attribute)
    assert.throws(() => runWithRehashedSyntheticHtml(plus, html), /binding refused/)
  }
  const deka = syntheticReviewedHtml(await fixture('dekamarkt-product-halfvolle-melk.v1.json'))
  for (const attribute of [
    'data-note="id=' + "'__NUXT_DATA__'" + '"',
    'id="fake" id="__NUXT_DATA__"',
  ]) {
    const html = deka.captured.html.replace('id="__NUXT_DATA__"', attribute)
    assert.throws(() => runWithRehashedSyntheticHtml(deka, html), /binding refused/)
  }
})

test('script-shaped text in HTML raw-text or inert containers must not prove product price', async () => {
  const original = syntheticReviewedHtml(await fixture('plus-rendered-product-halfvolle-melk.v1.json'))
  const script = /<script type="application\/ld\+json">[\s\S]*?<\/script>/.exec(original.captured.html)?.[0]
  assert.ok(script)
  for (const tag of ['textarea', 'noscript', 'style', 'title', 'iframe', 'svg', 'xmp']) {
    const html = original.captured.html.replace(script, '<' + tag + '>' + script + '</' + tag + '>')
    assert.throws(() => runWithRehashedSyntheticHtml(original, html), /binding refused/, tag)
  }
})

test('HTML parser refuses script-shaped tags inside an enclosing quoted attribute', async () => {
  const original = syntheticReviewedHtml(await fixture('plus-rendered-product-halfvolle-melk.v1.json'))
  const script = /<script type="application\/ld\+json">[\s\S]*?<\/script>/.exec(original.captured.html)?.[0]
  assert.ok(script)
  const html = original.captured.html.replace(script, '<div data-demo=' + "'" + script + "'" + '></div>')
  assert.throws(() => runWithRehashedSyntheticHtml(original, html), /binding refused/)
})

test('normal PLUS and Deka structured scripts remain accepted after bounded HTML tokenization', async () => {
  for (const filename of [
    'plus-rendered-product-halfvolle-melk.v1.json',
    'dekamarkt-product-halfvolle-melk.v1.json',
    'dekamarkt-catalog-melk.v1.json',
    'dekamarkt-offers.v1.json',
  ]) {
    const input = syntheticReviewedHtml(await fixture(filename))
    const result = bindPrivateReviewedHtmlEvidence(input.captured, input.reviewed)
    assert.ok(result.normalizedObservationCount > 0)
    assert.equal(result.productionEnabled, false)
    assert.equal(result.publishable, false)
    assert.equal(result.externalRequests, 0)
  }
})
