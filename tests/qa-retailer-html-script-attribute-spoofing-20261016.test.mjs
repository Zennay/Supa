/**
 * Independent SHA-binding quality check on frozen product owner #3353
 * 1a27dcb2fd3f32723204fd675da6463298ad0737.
 * HTML data-type/data-id must not impersonate actual type/id attributes:
 * they are ordinary data-* attributes, not JSON-LD or Nuxt script evidence.
 * Pure offline historical structured fixture + fictional generated HTML.
 * No network, retailer access, rights grant, publication or current prices.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { bindPrivateReviewedHtmlEvidence } from '../scripts/retailer-offline-html-evidence-binding.mjs'

async function fixedStructured(filename) {
  return JSON.parse(await readFile(new URL('../fixtures/m1/' + filename, import.meta.url), 'utf8'))
}
function synthetic(record, scriptTag, payload) {
  // A deliberately fictitious envelope around old checked-in structured
  // facts; it is NOT the original historical retailer HTML.
  const reviewed = structuredClone(record)
  const html = '<!doctype html><html><head>' + scriptTag + JSON.stringify(payload) +
    '</script></head><body>FICTIONAL OFFLINE FIXTURE</body></html>'
  const bytes = Buffer.byteLength(html, 'utf8')
  const sha256 = createHash('sha256').update(html, 'utf8').digest('hex')
  reviewed.source.sha256 = sha256
  if (reviewed.browserEvidence) reviewed.browserEvidence.renderedHtmlSha256 = sha256
  if (reviewed.captureEvidence) reviewed.captureEvidence.bytes = bytes
  return {
    reviewed,
    captured: {
      mode: 'authorized-one-page-capture-needs-review',
      permissionVerifiedForThisRequest: true,
      normalized: false, readyForIngestion: false, published: false,
      source: {
        retailerId: reviewed.source.supermarket,
        kind: reviewed.source.kind, url: reviewed.source.url,
        capturedAt: reviewed.source.capturedAt, sha256,
      },
      html, bytes,
    },
  }
}
for (const spec of [
  {
    name: 'PLUS JSON-LD',
    filename: 'plus-rendered-product-halfvolle-melk.v1.json',
    key: 'jsonLd',
    legitimate: '<script type="application/ld+json">',
    spoof: '<script data-type="application/ld+json">',
  },
  {
    name: 'Deka Nuxt',
    filename: 'dekamarkt-catalog-melk.v1.json',
    key: 'nuxtPayload',
    legitimate: '<script id="__NUXT_DATA__" type="application/json">',
    spoof: '<script data-id="__NUXT_DATA__" type="application/json">',
  },
]) {
  test('positive: real ' + spec.name + ' script attribute binds private-only reviewed facts', async () => {
    const record = await fixedStructured(spec.filename)
    const pair = synthetic(record, spec.legitimate, record[spec.key])
    const result = bindPrivateReviewedHtmlEvidence(pair.captured, pair.reviewed)
    assert.ok(result.normalizedObservationCount > 0)
    assert.equal(result.reviewRequired, true)
    assert.equal(result.rightsVerifiedForReuse, false)
    assert.equal(result.productionEnabled, false)
    assert.equal(result.publishable, false)
    assert.equal(result.livePricesAvailable, false)
    assert.equal(result.externalRequests, 0)
  })
  test('HTML ' + spec.name + ' data-* script attribute must not impersonate structured evidence [EXPECTED RED]', async () => {
    const record = await fixedStructured(spec.filename)
    const pair = synthetic(record, spec.spoof, record[spec.key])
    // Exact bytes, evidence SHA, rights flags and payload all agree; the
    // ONLY false claim is that an HTML data-* alias is a real script attribute.
    assert.throws(() => bindPrivateReviewedHtmlEvidence(pair.captured, pair.reviewed),
      /binding refused/,
      'data-type/data-id is NOT the authoritative script type/id HTML attribute')
  })
}
