import type { RawProductObservation } from './ingestion.ts'
import {
  parsePlusRenderedCatalogEvidence,
  parsePlusRenderedOffersEvidence,
  type PlusRenderedCatalogEvidence,
  type PlusRenderedOffersEvidence,
} from './plusRenderedListings.ts'
import {
  parseDekaMarktSsrCatalogEvidence,
  parseDekaMarktSsrOffersEvidence,
  type DekaMarktSsrCatalogEvidence,
  type DekaMarktSsrOffersEvidence,
} from './dekaMarktSsrListings.ts'
import {
  compareReviewedCatalogs, type CatalogComparison,
} from '../domain/reviewedCatalogComparison.ts'
import type { IngredientRequirement } from '../domain/matching.ts'

export type RetailerEvidence =
  | PlusRenderedCatalogEvidence
  | PlusRenderedOffersEvidence
  | DekaMarktSsrCatalogEvidence
  | DekaMarktSsrOffersEvidence

type ParseResult =
  | { type: 'observations'; observations: RawProductObservation[]; abstained: number }
  | { type: 'abstain'; reason: string }

export function parseRetailerCatalogEvidence(evidence: unknown): ParseResult {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return { type: 'abstain', reason: 'Invalid retailer evidence' }
  }
  const type = (evidence as { evidenceType?: unknown }).evidenceType
  try {
    switch (type) {
      case 'plus-browser-rendered-catalog':
        return parsePlusRenderedCatalogEvidence(evidence as PlusRenderedCatalogEvidence)
      case 'plus-browser-rendered-offers':
        return parsePlusRenderedOffersEvidence(evidence as PlusRenderedOffersEvidence)
      case 'dekamarkt-public-ssr-nuxt-catalog':
        return parseDekaMarktSsrCatalogEvidence(evidence as DekaMarktSsrCatalogEvidence)
      case 'dekamarkt-public-ssr-nuxt-offers':
        return parseDekaMarktSsrOffersEvidence(evidence as DekaMarktSsrOffersEvidence)
      default:
        return { type: 'abstain', reason: 'Unsupported retailer evidence format' }
    }
  } catch {
    return { type: 'abstain', reason: 'Invalid retailer evidence shape' }
  }
}

/** Consume existing reviewed PLUS rendered + DekaMarkt SSR evidence side by side. */
export function compareReviewedRetailerEvidence({
  requirements,
  evidence,
  nowMs,
}: {
  requirements: IngredientRequirement[]
  evidence: unknown[]
  nowMs: number
}): {
  provenance: 'reviewed-local-evidence'
  claimable: false
  parsedProducts: number
  abstainedProducts: number
  comparison: CatalogComparison
} {
  if (!Array.isArray(evidence) || evidence.length < 2 || evidence.length > 32) {
    throw new Error('Invalid bounded retailer evidence cohort')
  }
  const seenSources = new Set<string>()
  const observations: RawProductObservation[] = []
  let abstainedProducts = 0
  for (const item of evidence) {
    const parsed = parseRetailerCatalogEvidence(item)
    if (parsed.type !== 'observations') {
      throw new Error('Untrusted retailer evidence prevents basket comparison')
    }
    const source = parsed.observations[0]?.provenance
    if (!source || !['plus', 'dekamarkt'].includes(source.supermarket)) {
      throw new Error('Missing retailer evidence source')
    }
    const sourceKey = source.supermarket + ':' + source.kind
    if (seenSources.has(sourceKey)) {
      throw new Error('Duplicate retailer evidence category')
    }
    seenSources.add(sourceKey)
    observations.push(...parsed.observations)
    abstainedProducts += parsed.abstained
  }
  return {
    provenance: 'reviewed-local-evidence',
    claimable: false,
    parsedProducts: observations.length,
    abstainedProducts,
    comparison: compareReviewedCatalogs({ requirements, observations, nowMs }),
  }
}
