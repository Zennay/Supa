/**
 * Independent QA 2/2 on the frozen product preview owner branch.
 * All permissions, stores, URLs and monetary facts below are deliberately
 * FICTIONAL and consumed only by injected in-memory HTTP mocks.
 * Never use these grants for real network requests or public price claims.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { createAuthorizedRetailerProductPreviewSession } from '../scripts/retailer-authorized-product-preview.mjs'

const at = '2026-10-14T12:00:00.000Z'
const urls = {
  plus: 'https://www.plus.nl/product/fictional-qa-milk',
  dekamarkt: 'https://www.dekamarkt.nl/producten/fictional-qa-milk',
}
function mockGrant(retailer = 'plus', url = urls[retailer]) {
  return {
    source: { supermarket: retailer, kind: 'product', url },
    capturedAt: at,
    permissionGate: {
      version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-14',
      sources: ['plus', 'dekamarkt'].map(supermarket => ({
        supermarket, technicalStatus: 'proven',
        permissionStatus: 'permitted', productionEnabled: true,
        evidence: [{ kind: 'written_permission',
          url: 'https://example.test/fictional-node-qa-grant-only',
          finding: 'FICTIONAL NODE TEST. NOT REAL RETAILER PERMISSION.' }],
      })),
    },
    grant: {
      supermarket: retailer, kind: 'product', sourceUrl: url,
      reviewed: true, termsReviewed: true, robotsReviewed: true,
      noAntiBotBypass: true,
    },
  }
}
function product(retailer, price = '2.45') {
  return {
    '@context': 'https://schema.org', '@type': 'Product',
    url: urls[retailer], sku: 'FAKE-QA-MILK',
    name: 'FICTIONAL QA test only milk',
    weight: { '@type': 'QuantitativeValue', value: 500, unitCode: 'GRM' },
    offers: { '@type': 'Offer', price, priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock' },
  }
}
function markup(retailer, price) {
  return '<html><head><script type="application/ld+json">' +
    JSON.stringify(product(retailer, price)) + '</script></head></html>'
}
const reply = html => new Response(html, {
  status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
})
const privateFlags = ['currentPriceVerified', 'currentAvailabilityVerified',
  'productApprovedForIngestion', 'readyForIngestion', 'productionEnabled',
  'publicPricePublicationEnabled', 'publicSavingsClaimEligible']

test('separate fictional PLUS and Deka product previews remain SHA-bound, never live or public', async () => {
  const session = createAuthorizedRetailerProductPreviewSession()
  for (const retailer of ['plus', 'dekamarkt']) {
    const body = markup(retailer, retailer === 'plus' ? '2.45' : '1.79')
    let requests = 0
    const result = await session.previewOne({
      ...mockGrant(retailer),
      fetchFn: async (url, init) => {
        requests++
        assert.equal(url, urls[retailer])
        assert.equal(init.credentials, 'omit')
        assert.equal(init.redirect, 'error')
        return reply(body)
      },
    })
    assert.equal(requests, 1)
    assert.equal(result.reviewStatus, 'product-needs-human-review')
    assert.equal(result.sha256, createHash('sha256').update(body).digest('hex'))
    assert.equal(result.privateProductObservation.provenance.sha256, result.sha256)
    assert.equal(result.privateProductObservation.provenance.url, urls[retailer])
    assert.equal(result.privateProductObservation.provenance.capturedAt, at)
    assert.equal(result.privateOperatorOnly, true)
    assert.equal(result.htmlBodyIncluded, false)
    for (const key of privateFlags) assert.equal(result[key], false, key)
    assert.doesNotMatch(JSON.stringify(result), /<script|<html|fictional-node-qa-grant/)
    assert.equal(session.status().stores[retailer].verifiedCaptures, 1)
    assert.equal(session.status().stores[retailer].successfulHttpResponses, 1)
  }
  assert.equal(session.status().automaticRetries, 0)
  assert.equal(session.status().scheduledCaptureEnabled, false)
})

test('a malformed earlier declared JSON-LD document never falls back to a later plausible cheap price', async () => {
  const session = createAuthorizedRetailerProductPreviewSession()
  const corrupt = '<script type="application/ld+json">{"@type":"Product","url":</script>'
  const fallback = '<script type="application/ld+json">' +
    JSON.stringify(product('plus', '0.01')) + '</script>'
  const preview = await session.previewOne({
    ...mockGrant(),
    fetchFn: async () => reply('<html>' + corrupt + fallback + '</html>'),
  })
  assert.equal(preview.reviewStatus, 'abstained')
  assert.equal(preview.privateProductObservation, null)
  assert.equal(preview.currentPriceVerified, false)
  assert.equal(preview.publicSavingsClaimEligible, false)
  assert.doesNotMatch(JSON.stringify(preview), /0\.01|FAKE-QA-MILK|<script/)
  assert.equal(session.status().stores.plus.successfulHttpResponses, 1)
  assert.equal(session.status().stores.plus.verifiedCaptures, 1,
    'the HTML transport was valid even though the product evidence is not')
})

test('invalid UTF-8 HTTP 200 consumes failed-host cooldown, not a verified product', async t => {
  let now = Date.parse('2026-10-15T12:00:00.000Z')
  t.mock.method(Date, 'now', () => now)
  const session = createAuthorizedRetailerProductPreviewSession()
  let requests = 0
  const bad = async () => {
    requests++
    return new Response(new Uint8Array([0xc3, 0x28]), {
      status: 200, headers: { 'content-type': 'text/html' },
    })
  }
  await assert.rejects(session.previewOne({ ...mockGrant(), fetchFn: bad }))
  assert.equal(session.status().stores.plus.attemptedCaptures, 1)
  assert.equal(session.status().stores.plus.successfulHttpResponses, 1)
  assert.equal(session.status().stores.plus.verifiedCaptures, 0)
  assert.equal(session.status().stores.plus.busy, false)
  now += 11_000
  await assert.rejects(session.previewOne({ ...mockGrant(), fetchFn: bad }),
    /Retailer capture session refused/)
  assert.equal(requests, 1)
  now += 50_000
  const valid = await session.previewOne({
    ...mockGrant(), fetchFn: async () => { requests++; return reply(markup('plus')) },
  })
  assert.equal(valid.reviewStatus, 'product-needs-human-review')
  assert.equal(requests, 2)
  assert.equal(session.status().stores.plus.verifiedCaptures, 1)
  assert.equal(session.status().stores.plus.successfulHttpResponses, 2)
})

test('a PLUS hard throttle never disables independently licensed fictional DekaMarkt preview', async () => {
  const session = createAuthorizedRetailerProductPreviewSession()
  let plusCalls = 0, dekaCalls = 0
  const denied = { ...mockGrant('plus'),
    fetchFn: async () => { plusCalls++; return new Response('', { status: 429 }) } }
  await assert.rejects(session.previewOne(denied), /Retailer refused or rate-limited/)
  await assert.rejects(session.previewOne(denied), /Retailer capture session refused/)
  assert.equal(plusCalls, 1)
  assert.equal(session.status().stores.plus.hardStopped, true)
  const deka = await session.previewOne({
    ...mockGrant('dekamarkt'), fetchFn: async () => {
      dekaCalls++
      return reply(markup('dekamarkt'))
    },
  })
  assert.equal(deka.reviewStatus, 'product-needs-human-review')
  assert.equal(deka.publicSavingsClaimEligible, false)
  assert.equal(dekaCalls, 1)
  assert.equal(session.status().stores.dekamarkt.hardStopped, false)
  assert.equal(session.status().stores.dekamarkt.verifiedCaptures, 1)
  assert.equal(session.status().proxyRotationEnabled, false)
})

test('unfinished PLUS HTML body locks PLUS only; separate fictional Deka can finish', async () => {
  const session = createAuthorizedRetailerProductPreviewSession()
  let controller, began
  const entered = new Promise(resolve => { began = resolve })
  const stream = new ReadableStream({ start(value) { controller = value } })
  const first = session.previewOne({
    ...mockGrant('plus'),
    fetchFn: async () => {
      began()
      return new Response(stream, {
        status: 200, headers: { 'content-type': 'text/html' },
      })
    },
  })
  await entered
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(session.status().stores.plus.busy, true)
  let extra = 0
  await assert.rejects(session.previewOne({
    ...mockGrant('plus'), fetchFn: async () => { extra++; return reply(markup('plus')) },
  }), /Retailer capture session refused/)
  assert.equal(extra, 0)
  const deka = await session.previewOne({
    ...mockGrant('dekamarkt'),
    fetchFn: async () => reply(markup('dekamarkt')),
  })
  assert.equal(deka.reviewStatus, 'product-needs-human-review')
  assert.equal(session.status().stores.dekamarkt.verifiedCaptures, 1)
  assert.equal(session.status().stores.plus.busy, true)
  controller.enqueue(new TextEncoder().encode(markup('plus')))
  controller.close()
  const plus = await first
  assert.equal(plus.reviewStatus, 'product-needs-human-review')
  assert.equal(session.status().stores.plus.busy, false)
  assert.equal(session.status().stores.plus.verifiedCaptures, 1)
})

test('lookalike hosts, query tokens and unrelated route kinds never reach injected HTTP', async () => {
  const session = createAuthorizedRetailerProductPreviewSession()
  let network = 0
  for (const url of [
    'https://www.plus.nl.attacker.invalid/product/fictional-qa-milk',
    'https://www.plus.nl/product/fictional-qa-milk?session=forbidden',
    'https://www.plus.nl/product/fictional-qa-milk#hidden',
    'http://www.plus.nl/product/fictional-qa-milk',
    'https://www.plus.nl/aanbiedingen',
  ]) {
    await assert.rejects(session.previewOne({
      ...mockGrant('plus', url),
      fetchFn: async () => { network++; return reply(markup('plus')) },
    }))
  }
  for (const kind of ['catalog', 'offers']) {
    const input = mockGrant()
    input.source.kind = kind
    input.grant.kind = kind
    await assert.rejects(session.previewOne({
      ...input, fetchFn: async () => { network++; return reply(markup('plus')) },
    }), /Private authorized product preview refused/)
  }
  assert.equal(network, 0)
  assert.equal(session.status().stores.plus.attemptedCaptures, 0)
  assert.equal(session.status().stores.plus.verifiedCaptures, 0)
})
