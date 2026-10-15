/**
 * Consent-scoped ONE HTML capture -> SHA-pinned OFFLINE selector suggestions.
 *
 * This is an explicitly injected capability, not a CLI crawler or scheduled
 * scraper. The existing M1 gate + exact one-URL grant are checked before the
 * injected fetch function can be invoked. Returned CSS selectors are never
 * considered validated extraction rules, products, prices or savings.
 */
import { captureApprovedRetailerPage } from './retailer-approved-snapshot-capture.mjs'
import { proposeOfflineRetailerSelectors } from './retailer-offline-selector-discovery.mjs'

const refuse = () => { throw new Error('Authorized retailer capture-to-selector review refused') }

/**
 * Product-derived classes and test ids can contain identifiers or prices.
 * Return only known generic vocabulary; unknown source tokens stay private.
 */
const GENERIC_TOKENS = new Set([
  'product', 'product-card', 'product-tile', 'product-item',
  'item', 'item-card', 'item-tile', 'article', 'article-card',
  'name', 'product-name', 'item-name', 'title', 'product-title',
  'label', 'price', 'price-label', 'price-value', 'product-price',
  'cost', 'pack', 'pack-size', 'size', 'weight', 'volume', 'unit',
  'offer', 'offer-card', 'deal', 'deal-card', 'sale', 'discount',
  'availability', 'stock', 'quantity', 'content',
])
const GENERIC_TAG = '(?:article|a|div|li|section|span|h2|h3|p|strong|meta)'
const PLAIN_CLASS = new RegExp('^' + GENERIC_TAG + '\\.([a-z][a-z0-9_-]*)$', 'i')
const PLAIN_ATTRIBUTE = new RegExp(
  '^' + GENERIC_TAG + '\\[(?:data-testid|itemprop)="([a-z][a-z0-9_-]*)"\\]$', 'i',
)
const SAFE_FIXED_LINKS = new Set([
  'a[href^="/product/"]', 'a[href^="/producten/"]',
])
function privateSafeSelectorProposals(selectors) {
  return selectors.flatMap(({ field, selector, instances, status }) => {
    if (!['product', 'name', 'price', 'pack', 'offer', 'availability'].includes(field) ||
        status !== 'needs-human-review' ||
        !Number.isSafeInteger(instances) || instances < 1) return []
    const token = PLAIN_CLASS.exec(selector)?.[1] ?? PLAIN_ATTRIBUTE.exec(selector)?.[1]
    if (!SAFE_FIXED_LINKS.has(selector) && !GENERIC_TOKENS.has(token)) return []
    return [{ field, selector, instances, status: 'needs-human-review' }]
  })
}


/**
 * @param {object} options source, permissionGate, scope grant and injected fetchFn.
 * No default URL, fetch, browser, proxy, cookie, retry or storage capability.
 */
export async function captureToPrivateSelectorReview(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) refuse()
  const captured = await captureApprovedRetailerPage(options)
  if (captured.mode !== 'authorized-one-page-capture-needs-review' ||
      captured.permissionVerifiedForThisRequest !== true ||
      captured.readyForIngestion !== false ||
      captured.normalized !== false || captured.published !== false ||
      typeof captured.html !== 'string') refuse()

  // Re-read the actual bounded text through the source-independent offline
  // SHA calculator. A capture cannot promote selectors by passing through us.
  const proposals = proposeOfflineRetailerSelectors({
    html: captured.html,
    origin: {
      retailerId: captured.source.retailerId,
      url: captured.source.url,
      capturedAt: captured.source.capturedAt,
    },
  })
  if (proposals.mode !== 'offline-selector-proposals-only' ||
      proposals.source?.retailerId !== captured.source.retailerId ||
      proposals.source?.sha256 !== captured.source.sha256 ||
      proposals.source?.capturedAt !== captured.source.capturedAt ||
      proposals.bytes !== captured.bytes ||
      proposals.humanReviewRequired !== true ||
      proposals.readyForIngestion !== false ||
      proposals.permissionVerified !== false ||
      proposals.productionEnabled !== false ||
      proposals.publicSavingsClaimEligible !== false ||
      !Array.isArray(proposals.selectors) || proposals.selectors.length > 24 ||
      proposals.selectors.some(s => s.status !== 'needs-human-review')) refuse()

  const safeSelectors = privateSafeSelectorProposals(proposals.selectors)
  return {
    schemaVersion: 1,
    mode: 'authorized-one-capture-private-selector-review',
    source: {
      retailerId: captured.source.retailerId,
      kind: captured.source.kind,
      capturedAt: captured.source.capturedAt,
      sha256: captured.source.sha256,
    },
    capturedBytes: captured.bytes,
    inspectedTags: proposals.scannedTags,
    structuredSignals: proposals.structuredSignals,
    // Safe bounded selector metadata only. No HTML, prices, product identity,
    // source URLs, authentication material or implicit disk/network output.
    selectorProposals: safeSelectors,
    selectorProposalCount: safeSelectors.length,
    actualTransportInvocations: 1,
    scopeCheckedForThisOneCapture: true,
    humanSelectorApprovalRequired: true,
    sourceRightsForPublicationVerified: false,
    readyForIngestion: false,
    approvedSelectors: 0,
    currentPricesExtracted: false,
    scheduledFetchEnabled: false,
    publicSavingsClaimEligible: false,
    productionEnabled: false,
  }
}
