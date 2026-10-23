/**
 * Approved SINGLE product-page capture -> private structured price candidate.
 *
 * Completes the missing HTML -> JSON-LD -> canonical RawProductObservation link
 * on top of SUPA's existing source-authorized HTTP capture and product parser.
 * No default fetch, login, proxy, network scheduler, price publication or grant.
 *
 * This is deliberately an additional reviewed source path. Existing PLUS
 * rendered-artifact and DekaMarkt Nuxt evidence adapters stay authoritative
 * for pages which do not expose an unambiguous structured Product price.
 */
import { createHash } from 'node:crypto'
import { captureApprovedRetailerPage } from './retailer-approved-snapshot-capture.mjs'
import { readAuthorizedHtmlScriptEvidence } from './retailer-approved-html-script-evidence.mjs'
import { parseSchemaOrgProductForPage } from '../src/data/schemaOrgProductPageSelection.ts'
import { parseDekaNuxtFromAuthorizedHtml } from './retailer-approved-deka-nuxt-product.mjs'

const MAX_JSONLD_BLOCKS = 16
const MAX_CAPTURE_AGE_MS = 24 * 60 * 60 * 1000

function unavailable(reason, captured) {
  return {
    mode: 'private-authorized-html-product-candidate',
    status: 'review_required',
    reason,
    source: {
      retailerId: captured.source.retailerId,
      kind: captured.source.kind,
      url: captured.source.url,
      capturedAt: captured.source.capturedAt,
      sha256: captured.source.sha256,
    },
    observation: null,
    humanReviewRequired: true,
    permissionVerifiedForThisRequest: true,
    verifiedCurrentCheckoutPrice: false,
    publicSavingsClaimEligible: false,
    productionEnabled: false,
    published: false,
  }
}

/**
 * Caller supplies the exact source, permission document, reviewed one-URL
 * grant and injected fetchFn. The existing capture method checks all of
 * these BEFORE transport; in-repo rights explicitly refuse both retailers.
 *
 * The returned observation is PRIVATE REVIEW DATA, not a public price.
 * Read it only after the operator has confirmed source, package and region.
 */
export async function captureApprovedProductPriceCandidate(options = {}) {
  const captured = await captureApprovedRetailerPage(options)
  if (captured?.mode !== 'authorized-one-page-capture-needs-review' ||
      captured.permissionVerifiedForThisRequest !== true ||
      captured.readyForIngestion !== false ||
      captured.normalized !== false || captured.published !== false ||
      typeof captured.html !== 'string' ||
      !captured.source || typeof captured.source.sha256 !== 'string') {
    throw new Error('Authorized product capture contract invalid')
  }

  // Verify the exact UTF-8 bytes before trusting even the JSON-LD metadata.
  const htmlBytes = Buffer.from(captured.html, 'utf8')
  if (htmlBytes.length !== captured.bytes ||
      createHash('sha256').update(htmlBytes).digest('hex') !== captured.source.sha256) {
    throw new Error('Product source HTML digest mismatch')
  }

  if (captured.source.kind !== 'product') {
    return unavailable('not_a_product_page', captured)
  }
  const provenance = {
    supermarket: captured.source.retailerId,
    kind: captured.source.kind,
    url: captured.source.url,
    capturedAt: captured.source.capturedAt,
    sha256: captured.source.sha256,
  }

  const scripts = readAuthorizedHtmlScriptEvidence(captured.html)
  const blocks = scripts.jsonLdBlocks
  if (scripts.invalid || blocks.length === 0 || blocks.length > MAX_JSONLD_BLOCKS) {
    return unavailable('missing_or_invalid_jsonld', captured)
  }
  // All blocks are reviewed together: a second conflicting Product cannot be
  // ignored just because the first one offers a temptingly cheap price.
  let parsed = parseSchemaOrgProductForPage(blocks, provenance)
  // Some Deka SSR pages publish an uppercase JSON-LD Price and put the
  // physical pack and canonical price in Nuxt. Do not invent a generic
  // schema.org price; accept only the independently corroborated pair.
  if (provenance.supermarket === 'dekamarkt' &&
      (parsed.type !== 'observation' ||
       parsed.observation.currentPriceCents === null ||
       parsed.observation.pack.amount === null)) {
    const fallback = parseDekaNuxtFromAuthorizedHtml({
      html: captured.html, provenance, jsonLdBlocks: blocks,
    })
    if (fallback.type === 'observation') parsed = fallback
  }
  if (parsed.type !== 'observation') {
    return unavailable('product_identity_or_price_unverified', captured)
  }
  const observation = parsed.observation
  if (!Number.isSafeInteger(observation.currentPriceCents) ||
      observation.currentPriceCents <= 0 ||
      observation.pack.amount === null ||
      observation.pack.unit === 'unknown' ||
      observation.pack.unit === 'pack') {
    return unavailable('price_or_physical_pack_missing', captured)
  }
  // Captured now is NOT necessarily a current checkout or in-store price.
  // An old capture may still be useful in offline historical comparison, but
  // cannot be forwarded as a fresh price candidate.
  const capturedMs = Date.parse(provenance.capturedAt)
  if (!Number.isFinite(capturedMs) ||
      Date.now() - capturedMs > MAX_CAPTURE_AGE_MS ||
      capturedMs > Date.now() + 60_000) {
    return unavailable('stale_or_invalid_capture_clock', captured)
  }
  if (observation.availability !== 'available') {
    return unavailable('availability_unverified', captured)
  }
  return {
    mode: 'private-authorized-html-product-candidate',
    status: 'candidate_needs_review',
    reason: null,
    source: {
      retailerId: provenance.supermarket,
      kind: provenance.kind,
      url: provenance.url,
      capturedAt: provenance.capturedAt,
      sha256: provenance.sha256,
    },
    observation,
    humanReviewRequired: true,
    permissionVerifiedForThisRequest: true,
    verifiedCurrentCheckoutPrice: false,
    publicSavingsClaimEligible: false,
    productionEnabled: false,
    published: false,
  }
}
