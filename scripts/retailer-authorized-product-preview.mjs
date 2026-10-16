/**
 * Explicit operator-only HTML product preview: authorized single-page capture
 * -> canonical SHA-pinned offline JSON-LD product parser.
 *
 * A verified HTML transport is NOT a reviewed product, source reuse license,
 * current stock/price assertion, ingestion approval or public savings proof.
 * No default network client, automatic scheduler, retries, storage or logging.
 */
import { types as nodeTypes } from 'node:util'
import { createAuthorizedRetailerCaptureSession } from './retailer-authorized-capture-session.mjs'
import { parseM3OfflineProductHtml } from './m3-offline-html-product.mjs'

const refuse = () => { throw new Error('Private authorized product preview refused') }

// Refuse catalog/offer requests BEFORE any injected transport can run.
// Descriptors prevent executing caller accessors to inspect the route kind.
function requireProductRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      nodeTypes.isProxy(request) ||
      (Object.getPrototypeOf(request) !== Object.prototype &&
       Object.getPrototypeOf(request) !== null)) refuse()
  const sourceField = Object.getOwnPropertyDescriptor(request, 'source')
  if (!sourceField || !Object.hasOwn(sourceField, 'value')) refuse()
  const source = sourceField.value
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      nodeTypes.isProxy(source) ||
      (Object.getPrototypeOf(source) !== Object.prototype &&
       Object.getPrototypeOf(source) !== null)) refuse()
  const kind = Object.getOwnPropertyDescriptor(source, 'kind')
  if (!kind || !Object.hasOwn(kind, 'value') || kind.value !== 'product') refuse()
}

export function createAuthorizedRetailerProductPreviewSession() {
  const session = createAuthorizedRetailerCaptureSession()
  // Purely aggregate per-retailer parser outcomes, distinct from validated
  // transport captures. No URLs, HTML, product IDs or monetary fields.
  const reviews = new Map([
    ['plus', { accepted: 0, abstained: 0 }],
    ['dekamarkt', { accepted: 0, abstained: 0 }],
  ])

  async function previewOne(request) {
    requireProductRequest(request)
    // The canonical capture path deeply validates all source, grant and rights
    // fields before invoking the explicitly supplied transport.
    const captured = await session.captureOne(request)
    if (captured.mode !== 'authorized-one-page-capture-needs-review' ||
        captured.permissionVerifiedForThisRequest !== true ||
        captured.source?.kind !== 'product' ||
        captured.normalized !== false || captured.published !== false ||
        captured.readyForIngestion !== false ||
        typeof captured.html !== 'string') refuse()

    // Parsed values may be shown privately to a reviewer, but are NEVER
    // promoted to current prices, an ingestion batch or a public claim.
    const preview = parseM3OfflineProductHtml({
      source: {
        supermarket: captured.source.retailerId,
        kind: captured.source.kind,
        url: captured.source.url,
      },
      html: captured.html,
      capturedAt: captured.source.capturedAt,
    })
    const matching =
      preview.type === 'observation' &&
      preview.provenance?.sha256 === captured.source.sha256 &&
      preview.provenance?.url === captured.source.url &&
      preview.provenance?.capturedAt === captured.source.capturedAt &&
      preview.observation?.provenance?.sha256 === captured.source.sha256 &&
      preview.observation?.provenance?.url === captured.source.url &&
      preview.observation?.provenance?.capturedAt === captured.source.capturedAt
    if (preview.type !== 'abstain' && !matching) refuse()
    const counts = reviews.get(captured.source.retailerId)
    if (!counts) refuse()
    if (matching) counts.accepted++
    else counts.abstained++
    // Errors/abstentions never reveal partial unverified price observations.
    return {
      schemaVersion: 1,
      mode: 'authorized-private-product-preview',
      retailerId: captured.source.retailerId,
      capturedAt: captured.source.capturedAt,
      sha256: captured.source.sha256,
      capturedBytes: captured.bytes,
      reviewStatus: matching ? 'product-needs-human-review' : 'abstained',
      privateProductObservation: matching ? preview.observation : null,
      privateOperatorOnly: true,
      htmlBodyIncluded: false,
      currentPriceVerified: false,
      currentAvailabilityVerified: false,
      productApprovedForIngestion: false,
      readyForIngestion: false,
      productionEnabled: false,
      publicPricePublicationEnabled: false,
      publicSavingsClaimEligible: false,
    }
  }

  return Object.freeze({
    previewOne,
    status: () => ({
      ...session.status(),
      privateProductReviewCounts: Object.fromEntries(
        [...reviews.entries()].map(([retailer, counts]) =>
          [retailer, { accepted: counts.accepted, abstained: counts.abstained }]),
      ),
    }),
  })
}
