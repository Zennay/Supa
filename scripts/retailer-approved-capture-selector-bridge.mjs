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
      captured.source?.retailerId !== options.source?.supermarket ||
      captured.source?.kind !== options.source?.kind ||
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
    selectorProposals: proposals.selectors,
    selectorProposalCount: proposals.selectors.length,
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
