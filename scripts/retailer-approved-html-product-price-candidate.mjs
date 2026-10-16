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

// Deka pages can carry both Schema.org lowercase Offer.price and a legacy
// uppercase Price, while Nuxt has a corroborating value. A generic parser
// must not select either case spelling and silently discard its contradictory
// sibling before the Deka-specific cross-check has an opportunity to refuse.
function conflictingCaseOfferPrices(blocks) {
  const stack = [...blocks]
  while (stack.length) {
    const value = stack.pop()
    if (!value || typeof value !== 'object') continue
    if (Array.isArray(value)) {
      for (const child of value) stack.push(child)
      continue
    }
    const keys = Object.keys(value)
    const explicitPrices = keys.filter(key => key.toLowerCase() === 'price')
    if (explicitPrices.length > 1) {
      const cents = explicitPrices.map(key => {
        const raw = value[key]
        if (typeof raw !== 'number' && typeof raw !== 'string') return null
        const scaled = Number(raw) * 100
        const rounded = Math.round(scaled)
        return Number.isFinite(scaled) && Number.isSafeInteger(rounded) &&
          rounded > 0 && Math.abs(scaled - rounded) <= 1e-7 ? rounded : null
      })
      if (cents.some(c => c === null || c !== cents[0])) return true
    }
    for (const child of Object.values(value)) stack.push(child)
  }
  return false
}

// When BOTH lowercase price and uppercase Price are present, agreement
// between them is not independent evidence of the actual page price. Require
// the same-page Deka Nuxt source to corroborate before any private candidate.
function hasDualCaseOfferPrices(blocks) {
  const stack = [...blocks]
  while (stack.length) {
    const value = stack.pop()
    if (!value || typeof value !== 'object') continue
    if (Array.isArray(value)) {
      stack.push(...value)
      continue
    }
    if (Object.keys(value).filter(key => key.toLowerCase() === 'price').length > 1) {
      return true
    }
    stack.push(...Object.values(value))
  }
  return false
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
  // All approved retailers must refuse same-object price contradictions.
  // Otherwise the generic Schema.org parser can select PLUS offer.price
  // while silently discarding an explicitly different Offer.Price/PRICE.
  // Deka's independent Nuxt corroboration remains separately required.
  if (conflictingCaseOfferPrices(blocks)) {
    return unavailable('contradictory_same_page_price_evidence', captured)
  }
  // All blocks are reviewed together: a second conflicting Product cannot be
  // ignored just because the first one offers a temptingly cheap price.
  let parsed = parseSchemaOrgProductForPage(blocks, provenance)
  const deka = provenance.supermarket === 'dekamarkt'
  const hasCasePair = deka && hasDualCaseOfferPrices(blocks)
  // Even two agreeing spellings are not independent corroboration. In this
  // case, require the strict Deka parser to compare JSON-LD with the same-page
  // Nuxt price and pack. Never fall through a successful generic Schema.org
  // candidate when Nuxt is missing, unparseable or disagrees.
  if (hasCasePair) {
    const corroborated = parseDekaNuxtFromAuthorizedHtml({
      html: captured.html, provenance, jsonLdBlocks: blocks,
    })
    if (corroborated.type !== 'observation') {
      return unavailable('contradictory_same_page_price_evidence', captured)
    }
    parsed = corroborated
  } else if (deka &&
      (parsed.type !== 'observation' ||
       parsed.observation.currentPriceCents === null ||
       parsed.observation.pack.amount === null)) {
    // Historical uppercase-only Deka pages also require independent Nuxt.
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
