/**
 * Consent-scoped ONE HTML capture -> SHA-pinned OFFLINE selector suggestions.
 *
 * This is an explicitly injected capability, not a CLI crawler or scheduled
 * scraper. The existing M1 gate + exact one-URL grant are checked before the
 * injected fetch function can be invoked. Returned CSS selectors are never
 * considered validated extraction rules, products, prices or savings.
 */
import { types as nodeTypes } from 'node:util'
import { captureApprovedRetailerPage } from './retailer-approved-snapshot-capture.mjs'
import { proposeOfflineRetailerSelectors } from './retailer-offline-selector-discovery.mjs'
import { isPublicMerchantProductHrefSelector } from './retailer-public-product-href-selectors.mjs'
import { isSafeStructuralReviewTag } from './retailer-public-structural-tag.mjs'
import { isFormerPriceTag, PUBLIC_OBSERVED_TOKEN_FIELDS } from './retailer-public-observed-token-fields.mjs'

const refuse = () => { throw new Error('Authorized retailer capture-to-selector review refused') }

/**
 * Snapshot every authorization fact through own DATA descriptors before any
 * permission validator is called. A getter can otherwise change the caller's
 * permission document between validation and opening the injected transport.
 * No Proxy, accessor, prototype inheritance or sparse arrays are trusted.
 */
function inertData(value, depth = 0) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol') refuse()
    return value
  }
  if (depth > 10 || nodeTypes.isProxy(value)) refuse()
  const array = Array.isArray(value)
  const proto = Object.getPrototypeOf(value)
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) refuse()
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string')) refuse()
  if (array) {
    const length = descriptors.length
    if (!Object.hasOwn(length, 'value') || length.value > 256) refuse()
    const copy = []
    for (let index = 0; index < length.value; index++) {
      const entry = descriptors[index]
      if (!entry || !Object.hasOwn(entry, 'value')) refuse()
      copy.push(inertData(entry.value, depth + 1))
    }
    if (Reflect.ownKeys(descriptors).length !== length.value + 1) refuse()
    return copy
  }
  if (Object.keys(descriptors).length > 128) refuse()
  const copy = Object.create(null)
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!Object.hasOwn(descriptor, 'value') || key === '__proto__') refuse()
    copy[key] = inertData(descriptor.value, depth + 1)
  }
  return copy
}

function inertCaptureOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      nodeTypes.isProxy(options)) refuse()
  const descriptor = Object.getOwnPropertyDescriptors(options)
  const supported = ['source', 'permissionGate', 'grant', 'fetchFn', 'capturedAt']
  if (Reflect.ownKeys(descriptor).some(key => !supported.includes(key))) refuse()
  const copy = {}
  for (const key of supported) {
    const entry = descriptor[key]
    if (!entry) continue
    if (!Object.hasOwn(entry, 'value')) refuse()
    copy[key] = key === 'fetchFn' ? entry.value : inertData(entry.value)
  }
  return copy
}

// Metadata returned to an operator is not allowed to include unique CSS
// source tokens: class names or data-testid attributes can encode a product
// identifier or price. Only a bounded vocabulary of generic selectors leaves
// the private captured HTML scope; unknown selectors stay in private review.
const GENERIC_SELECTOR = /^[a-z][a-z0-9-]{0,30}\.(?:product|item|card|tile|name|title|label|price|pack|size|unit|offer|deal|sale|discount|stock|availability|product-card|price-label|price-value|offer-card|product-name|item-card|item-name|product-title|item-title|product-price|item-price|price-tag|stock-label|pack-size|offer-label)$/
// These are actual standards-based selectors from the captured DOM, not
// inferred retail fields. Allow exact public Schema.org tokens and a bounded
// vocabulary of generic test IDs across the privacy/review boundary.
const SCHEMA_FIELDS = Object.freeze({
  name: 'name', price: 'price', lowPrice: 'price', highPrice: 'price',
  priceCurrency: 'price', priceSpecification: 'price',
  priceValidUntil: 'offer', offers: 'offer', weight: 'pack',
  size: 'pack', unitCode: 'pack', unitText: 'pack',
  availability: 'availability', inventoryLevel: 'availability',
})
const SCHEMA_PROP_SELECTOR = /^(article|section|div|li|a|span|h[1-6]|p|strong|ins|del|s|strike|small|meta|link|data|time|[a-z][a-z0-9]*-[a-z0-9-]{1,31})\[itemprop="([a-zA-Z]+)"\]$/
const GENERIC_TEST_ID_SELECTOR = /^(article|section|div|li|a|span|h[1-6]|p|strong|ins|del|s|strike|small|meta|link|data|time|[a-z][a-z0-9]*-[a-z0-9-]{1,31})\[data-testid="([a-z][a-z-]+)"\]$/
const SCHEMA_PRODUCT_SELECTOR = /^(article|section|div|li|a)\[itemtype="https?:\/\/schema\.org\/Product"\]$/
function publicReviewSelector(row, retailerId) {
  // Source tag names may themselves be user/product identifiers; the same
  // bounded structural vocabulary applies to both independent review paths.
  const tag = /^[a-z][a-z0-9-]*/.exec(row.selector)?.[0]
  if (!isSafeStructuralReviewTag(tag)) return false
  if (GENERIC_SELECTOR.test(row.selector)) return true
  const schemaProperty = SCHEMA_PROP_SELECTOR.exec(row.selector)
  if (schemaProperty) return Object.hasOwn(SCHEMA_FIELDS, schemaProperty[2]) &&
    (SCHEMA_FIELDS[schemaProperty[2]] === row.field ||
      (isFormerPriceTag(schemaProperty[1]) && row.field === 'offer' &&
        SCHEMA_FIELDS[schemaProperty[2]] === 'price'))
  const testId = GENERIC_TEST_ID_SELECTOR.exec(row.selector)
  if (testId) return Object.hasOwn(PUBLIC_OBSERVED_TOKEN_FIELDS, testId[2]) &&
    (PUBLIC_OBSERVED_TOKEN_FIELDS[testId[2]] === row.field ||
      (isFormerPriceTag(testId[1]) && row.field === 'offer' &&
       PUBLIC_OBSERVED_TOKEN_FIELDS[testId[2]] === 'price'))
  return row.field === 'product' &&
    (SCHEMA_PRODUCT_SELECTOR.test(row.selector) ||
      isPublicMerchantProductHrefSelector(retailerId, row.selector))
}
// The only absolute href prefixes allowed out of private source review are
// official merchant product roots, never a SKU, query or arbitrary URL.
export function safeSelectorProposals(selectors, retailerId) {
  if (!Array.isArray(selectors) || selectors.length > 24) refuse()
  return selectors.filter(row =>
    row && row.status === 'needs-human-review' &&
    typeof row.selector === 'string' &&
    typeof row.field === 'string' && /^[a-z]{2,20}$/.test(row.field) &&
    publicReviewSelector(row, retailerId) &&
    typeof row.instances === 'number' && Number.isSafeInteger(row.instances) &&
    row.instances >= 1
  ).map(row => ({
    field: row.field, selector: row.selector,
    tag: /^[a-z][a-z0-9-]*/.exec(row.selector)?.[0],
    instances: row.instances, status: 'needs-human-review',
  }))
}

/**
 * @param {object} options source, permissionGate, scope grant and injected fetchFn.
 * No default URL, fetch, browser, proxy, cookie, retry or storage capability.
 */
export async function captureToPrivateSelectorReview(options = {}) {
  // No caller-controlled accessor executes during capture authorization.
  // Downstream helpers see private detached copies, not mutable caller input.
  const capturedOptions = inertCaptureOptions(options)
  const captured = await captureApprovedRetailerPage(capturedOptions)
  if (captured.mode !== 'authorized-one-page-capture-needs-review' ||
      captured.permissionVerifiedForThisRequest !== true ||
      captured.readyForIngestion !== false ||
      captured.normalized !== false || captured.published !== false ||
      captured.source?.retailerId !== capturedOptions.source?.supermarket ||
      captured.source?.kind !== capturedOptions.source?.kind ||
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

  const safeSelectors = safeSelectorProposals(proposals.selectors, captured.source.retailerId)
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
