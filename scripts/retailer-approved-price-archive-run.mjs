/**
 * The first complete own-scraper pipeline:
 * permitted retailer HTML -> verified private product-price candidate ->
 * exclusive 0600 review archive.
 *
 * No implicit HTTP capability, keys, proxy, cookies, scheduler or publication.
 * All real PLUS/Deka requests still fail before transport under checked-in
 * source-permission-gate.v1.json until separately approved.
 */
import { captureApprovedProductPriceCandidate } from './retailer-approved-html-product-price-candidate.mjs'
import { writePrivateRetailerPriceSnapshot } from './retailer-approved-private-price-snapshot-store.mjs'

export async function captureAndArchiveApprovedRetailerProduct(captureOptions, privateOutputFile) {
  const candidate = await captureApprovedProductPriceCandidate(captureOptions)
  const saved = await writePrivateRetailerPriceSnapshot([candidate], privateOutputFile)
  return {
    mode: 'private-one-product-capture-and-archive',
    priceCandidateStatus: candidate.status,
    archiveCreated: true,
    reviewRequired: true,
    candidateCount: saved.candidateCount,
    reviewRequiredCount: saved.reviewRequiredCount,
    // No product URL, individual price, private path or user details in stdout.
    sourceRightsForPublicationVerified: false,
    verifiedCheckoutPrice: false,
    productionEnabled: false,
    published: false,
    publicSavingsClaimEligible: false,
  }
}

// One fetch -> combined private selector/price archive (all M1 page kinds).
export { captureAndArchiveApprovedSourceReview } from './retailer-approved-source-review-archive.mjs'
