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
import { proposeOfflineRetailerSelectors } from './retailer-offline-selector-discovery.mjs'
import { parseSchemaOrgProductForPage } from '../src/data/schemaOrgProductPageSelection.ts'
import { corroborateDekaNuxtProduct } from './retailer-approved-deka-nuxt-product.mjs'

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
function priceReviewFromAuthorizedCapture(captured) {
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

  const scripts = readAuthorizedHtmlScriptEvidence(captured.html, captured.source.url)
  const blocks = scripts.jsonLdBlocks
  if (scripts.invalid || blocks.length === 0 || blocks.length > MAX_JSONLD_BLOCKS) {
    return unavailable('missing_or_invalid_jsonld', captured)
  }
  // All blocks are reviewed together: a second conflicting Product cannot be
  // ignored just because the first one offers a temptingly cheap price.
  let parsed = parseSchemaOrgProductForPage(blocks, provenance)
  // A valid-looking JSON-LD offer cannot overrule a contradictory same-page
  // Nuxt price, SKU or physical pack. Corroboration is required both ways.
  if (provenance.supermarket === 'dekamarkt') {
    parsed = corroborateDekaNuxtProduct({
      html: captured.html, provenance, jsonLdBlocks: blocks,
      structured: parsed, nuxtPresent: scripts.nuxtPayload !== null,
    })
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

// Product and CSS structure used to require separate HTTP captures. A single
// authorization-scoped fetch now produces TWO private reviews pinned to the
// exact same HTML digest and UTC clock. Never reuse a raw caller-supplied
// capture or treat selector guesses as approved price extraction rules.
export async function captureApprovedProductReviewBundle(options = {}) {
  const captured = await captureApprovedRetailerPage(options)
  const priceReview = priceReviewFromAuthorizedCapture(captured)
  if (captured.source.kind !== 'product') {
    throw new Error('Authorized product review bundle requires a product page')
  }
  const selectors = proposeOfflineRetailerSelectors({
    html: captured.html,
    origin: {
      retailerId: captured.source.retailerId,
      url: captured.source.url,
      capturedAt: captured.source.capturedAt,
    },
  })
  if (selectors.mode !== 'offline-selector-proposals-only' ||
      selectors.source?.retailerId !== priceReview.source.retailerId ||
      selectors.source?.sha256 !== priceReview.source.sha256 ||
      selectors.source?.capturedAt !== priceReview.source.capturedAt ||
      selectors.bytes !== captured.bytes ||
      selectors.humanReviewRequired !== true ||
      selectors.readyForIngestion !== false ||
      selectors.permissionVerified !== false ||
      selectors.productionEnabled !== false ||
      selectors.publicSavingsClaimEligible !== false ||
      !Array.isArray(selectors.selectors) || selectors.selectors.length > 24 ||
      selectors.selectors.some(row => row.status !== 'needs-human-review')) {
    throw new Error('Authorized product selector and price provenance disagree')
  }
  return {
    schemaVersion: 1,
    mode: 'private-authorized-one-capture-product-review',
    source: priceReview.source,
    capturedBytes: captured.bytes,
    actualTransportInvocations: 1,
    priceReview,
    selectorReview: {
      mode: 'private-unapproved-selector-proposals',
      structuredSignals: selectors.structuredSignals,
      proposals: selectors.selectors,
      inspectedTags: selectors.scannedTags,
      humanReviewRequired: true,
      approvedSelectors: 0,
    },
    rawHtmlReturned: false,
    humanReviewRequired: true,
    verifiedCurrentCheckoutPrice: false,
    sourceRightsForPublicationVerified: false,
    publicSavingsClaimEligible: false,
    readyForIngestion: false,
    productionEnabled: false,
    published: false,
  }
}

export async function captureApprovedProductPriceCandidate(options = {}) {
  return priceReviewFromAuthorizedCapture(await captureApprovedRetailerPage(options))
}
