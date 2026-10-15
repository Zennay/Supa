import { matchIngredient, type MatchUnit, type ProductCandidate } from './matching.ts'

/**
 * Private review ONLY: reuse the canonical planner demand and fuzzy matcher
 * against offline historical retailer captures. This adapter never returns a
 * price, basket total, evidence, observed availability or savings conclusion.
 * Suggestions must be checked by a human against genuine current store data.
 */
type Requirement = {
  id: string
  label: string
  query: string
  amount: number
  unit: MatchUnit
}
type Capture = {
  name: string
  currency: string
  capturedAt: string
  snapshotSha256: string
  availability: string
  pack: { amount: number | null; unit: string; rawText: string | null }
}
type CatalogProduct = {
  canonicalKey: string
  retailerId: string
  retailerProductId: string
  consistency: string
  currentTrustedPriceCents: null
  selectedSnapshotSha256: null
  sourceRightsVerified: false
  publishable: false
  captures: Capture[]
}
type Catalog = {
  schemaVersion: number
  model: string
  status: string
  productionEnabled: boolean
  publicSavingsClaimEligible: boolean
  productCount: number
  products: CatalogProduct[]
}
export type ReviewedPlannerRow = {
  retailerId: 'plus' | 'dekamarkt'
  ingredientId: string
  ingredientLabel: string
  required: { amount: number; unit: MatchUnit }
  status: 'suggested-for-manual-review' | 'unresolved'
  candidate: null | {
    canonicalKey: string
    productName: string
    packAmount: number
    packUnit: MatchUnit
    matchScore: number
    captureCount: number
  }
  reasons: string[]
}
export type ReviewedPlannerQueue = {
  mode: 'historical-catalog-human-review-only'
  sourceStatus: 'private-review-only'
  productionEnabled: false
  publicSavingsClaimEligible: false
  completeFieldEvidence: false
  needsHumanSourceReview: true
  rows: ReviewedPlannerRow[]
}

const STORES = ['plus', 'dekamarkt'] as const
const UNITS: ReadonlySet<string> = new Set(['g', 'kg', 'ml', 'l', 'piece'])
const SAFE_ID = /^[a-zA-Z0-9._:-]{1,170}$/

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function approvedCatalog(value: unknown): value is Catalog {
  if (!record(value) || value.schemaVersion !== 1 ||
      value.model !== 'universal-retailer-product-captures' ||
      value.status !== 'private-review-only' ||
      value.productionEnabled !== false ||
      value.publicSavingsClaimEligible !== false ||
      !Array.isArray(value.products) || value.products.length > 5000 ||
      value.productCount !== value.products.length) return false
  return true
}
function validRequirements(value: unknown): value is Requirement[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return false
  const seen = new Set<string>()
  for (let i = 0; i < value.length; i += 1) {
    if (!Object.hasOwn(value, i)) return false
    const r: unknown = value[i]
    if (!record(r) || typeof r.id !== 'string' || !SAFE_ID.test(r.id) ||
        seen.has(r.id) || typeof r.label !== 'string' || !r.label.trim() ||
        typeof r.query !== 'string' || !r.query.trim() ||
        typeof r.amount !== 'number' || !Number.isFinite(r.amount) || r.amount <= 0 ||
        !UNITS.has(r.unit as string)) return false
    seen.add(r.id)
  }
  return true
}
function usableCapture(value: unknown): value is Capture {
  if (!record(value) || typeof value.name !== 'string' || !value.name.trim() ||
      value.currency !== 'EUR' || value.availability !== 'available' ||
      typeof value.capturedAt !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value.capturedAt) ||
      !Number.isFinite(Date.parse(value.capturedAt)) ||
      typeof value.snapshotSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.snapshotSha256) ||
      !record(value.pack)) return false
  const pack = value.pack
  // No inferred multipacks: RawPack lacks an independently verified count.
  // A 'pack' unit or e.g. '6 x 200 ml' is a human-only quantity decision.
  return typeof pack.amount === 'number' &&
    Number.isFinite(pack.amount) && pack.amount > 0 &&
    UNITS.has(pack.unit as string) &&
    (pack.rawText === null ||
      (typeof pack.rawText === 'string' &&
        !/\d\s*(?:x|×)\s*\d/iu.test(pack.rawText)))
}
function sourceCandidates(catalog: Catalog, store: typeof STORES[number]) {
  const candidates: ProductCandidate[] = []
  const suggestions = new Map<string, { product: CatalogProduct; capture: Capture }>()
  const identities = new Set<string>()
  for (const item of catalog.products) {
    if (!record(item) || !STORES.includes(item.retailerId as typeof STORES[number]) ||
        typeof item.retailerProductId !== 'string' ||
        !SAFE_ID.test(item.retailerProductId) ||
        item.canonicalKey !== item.retailerId + ':' + item.retailerProductId ||
        identities.has(item.canonicalKey) ||
        item.sourceRightsVerified !== false ||
        item.publishable !== false ||
        item.currentTrustedPriceCents !== null ||
        item.selectedSnapshotSha256 !== null ||
        !Array.isArray(item.captures) || item.captures.length < 1 ||
        item.captures.length > 32 ||
        !['consistent', 'review-required'].includes(item.consistency)) {
      throw new Error('Reviewed catalog contains unsupported source identity or publication metadata')
    }
    identities.add(item.canonicalKey)
    if (item.retailerId !== store || item.consistency !== 'consistent' ||
        !item.captures.every(usableCapture)) continue
    // Same capture facts may be repeated across product/listing/offers pages.
    // This is a suggestion only; no prices, offers or freshness are selected.
    const capture = item.captures[0]
    candidates.push({
      id: item.canonicalKey,
      name: capture.name,
      packAmount: capture.pack.amount!,
      packUnit: capture.pack.unit as MatchUnit,
      available: true,
    })
    suggestions.set(item.canonicalKey, { product: item, capture })
  }
  return { candidates, suggestions }
}

export function buildReviewedCatalogPlannerQueue(
  catalogInput: unknown,
  requirementsInput: unknown,
): ReviewedPlannerQueue {
  if (!approvedCatalog(catalogInput) || !validRequirements(requirementsInput)) {
    throw new Error('Reviewed catalog/planner contract refused')
  }
  const rows: ReviewedPlannerRow[] = []
  for (const retailerId of STORES) {
    const { candidates, suggestions } = sourceCandidates(catalogInput, retailerId)
    for (const requirement of requirementsInput) {
      const required = { amount: requirement.amount, unit: requirement.unit }
      const decision = matchIngredient(requirement, candidates)
      const proposal = decision.type === 'match'
        ? suggestions.get(decision.productId)
        : undefined
      rows.push({
        retailerId,
        ingredientId: requirement.id,
        ingredientLabel: requirement.label,
        required,
        status: proposal ? 'suggested-for-manual-review' : 'unresolved',
        candidate: proposal ? {
          canonicalKey: proposal.product.canonicalKey,
          productName: proposal.capture.name,
          packAmount: proposal.capture.pack.amount!,
          packUnit: proposal.capture.pack.unit as MatchUnit,
          matchScore: decision.type === 'match' ? decision.score : 0,
          captureCount: proposal.product.captures.length,
        } : null,
        reasons: proposal
          ? ['historical product suggestion only; verify quantity, availability, identity and current price manually']
          : ['no unambiguous reviewed historical product suggestion'],
      })
    }
  }
  return {
    mode: 'historical-catalog-human-review-only',
    sourceStatus: 'private-review-only',
    productionEnabled: false,
    publicSavingsClaimEligible: false,
    completeFieldEvidence: false,
    needsHumanSourceReview: true,
    rows,
  }
}
