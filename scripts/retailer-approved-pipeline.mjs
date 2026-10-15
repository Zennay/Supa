import { fetchAuthorizedRetailerHtml } from './retailer-authorized-fetch.mjs'
import { parseOfflineRetailerSnapshot } from './retailer-snapshot-adapters.mjs'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

const APPROVED_PRODUCT_SOURCE_IDS = [
  'plus-product-halfvolle-melk',
  'dekamarkt-product-halfvolle-melk',
]

/**
 * Opt-in, two-source comparison orchestration.
 *
 * This has no schedule and is not wired to the app. The genuine HTTP transport
 * reads the checked-in rights register and requires SUPA_LIVE_RETAILER_CAPTURE=1.
 * Test transports cannot grant real-world source rights or release permission.
 */
export async function runApprovedRetailerComparison({
  requirements,
  permissionDocument,
  enableLive = false,
  fetchImpl = fetch,
  nowMs = Date.now(),
}) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error('Invalid ingestion clock')
  }
  // An opt-out must always report disabled, even for an empty draft basket.
  // Both disabled and invalid demand are checked before any network traffic.
  if (enableLive !== true) throw new Error('Live collection is disabled')
  // Reject an impossible basket before any permission-gated third-party I/O.
  // Use the same canonical identity/duplicate/shape validator as the final
  // comparison instead of paying network cost before discovering bad demand.
  compareReviewedCatalogs({ requirements, observations: [], nowMs })
  for (const required of requirements) {
    if (!Number.isFinite(required.amount) || required.amount <= 0 ||
        !['g', 'kg', 'ml', 'l', 'piece'].includes(required.unit)) {
      throw new Error('Invalid comparison demand quantity or unit')
    }
  }
  const observations = []
  const captureSummary = []

  // Deliberately serial, limited to the two pinned product pages.
  // Never fan out through a proxy pool or retry a retailer's 403/429.
  for (const sourceId of APPROVED_PRODUCT_SOURCE_IDS) {
    const snapshot = await fetchAuthorizedRetailerHtml({
      sourceId, permissionDocument, enableLive, fetchImpl,
      capturedAtMs: nowMs,
    })
    const parsed = parseOfflineRetailerSnapshot({
      source: snapshot.source,
      html: snapshot.html,
      capturedAt: snapshot.capturedAt,
    })
    observations.push(...parsed.observations)
    captureSummary.push({
      sourceId,
      sha256: snapshot.sha256,
      capturedAt: snapshot.capturedAt,
      bytes: snapshot.bytes,
      extractedProducts: parsed.observations.length,
      rejected: parsed.rejected,
    })
  }

  return {
    provenance: 'unreleased-approved-capture-preview',
    claimable: false,
    captureSummary,
    comparison: compareReviewedCatalogs({ requirements, observations, nowMs }),
  }
}
