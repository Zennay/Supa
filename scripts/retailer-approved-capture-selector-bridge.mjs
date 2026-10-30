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
const GENERIC_SELECTOR = /^(?:a\[href\^="\/(?:product|producten)\/"\]|[a-z][a-z0-9-]{0,30}\.(?:product|item|card|tile|name|title|label|price|pack|size|unit|offer|deal|sale|discount|stock|availability|product-card|price-label|offer-card|product-name|item-card|item-name|price-tag|stock-label))$/
// The only absolute href prefixes allowed out of private source review are
// known official merchant product roots, never a SKU, query or arbitrary URL.
const SAFE_ABSOLUTE_PRODUCT_HREF_SELECTORS = new Set([
  'a[href^="https://www.plus.nl/product/"]',
  'a[href^="//www.plus.nl/product/"]',
  'a[href^="https://www.dekamarkt.nl/producten/"]',
  'a[href^="//www.dekamarkt.nl/producten/"]',
])
function safeSelectorProposals(selectors) {
  if (!Array.isArray(selectors) || selectors.length > 24) refuse()
  return selectors.filter(row =>
    row && row.status === 'needs-human-review' &&
    typeof row.selector === 'string' &&
    (GENERIC_SELECTOR.test(row.selector) ||
      SAFE_ABSOLUTE_PRODUCT_HREF_SELECTORS.has(row.selector)) &&
    typeof row.field === 'string' && /^[a-z]{2,20}$/.test(row.field) &&
    typeof row.instances === 'number' && Number.isSafeInteger(row.instances) &&
    row.instances >= 1
  ).map(row => ({
    field: row.field, selector: row.selector, tag: row.tag,
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

  const safeSelectors = safeSelectorProposals(proposals.selectors)
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
