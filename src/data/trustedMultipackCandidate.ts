import type { RawPack } from './ingestion.ts'
import { normalizePackText } from './normalize.ts'
import type { ProductCandidate } from '../domain/matching.ts'

/**
 * Safely recover per-unit quantity AND count from a source pack's original text.
 *
 * The current RawPack contract stores amount/unit but not multipack count.
 * Until ingestion and the source adapters carry count end-to-end (#168), never
 * silently assume that "6 x 1 l" means a single 1 l package.
 *
 * This is an opt-in projection helper, NOT approval to ingest/reuse retailer data.
 * Callers must retain source provenance and the retailer permission boundary.
 */
export function projectTrustedPackForMatching(
  pack: RawPack,
): Pick<ProductCandidate, 'packAmount' | 'packUnit' | 'packCount'> | null {
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) return null
  if (typeof pack.rawText !== 'string' || !pack.rawText.trim()) return null

  const normalized = normalizePackText(pack.rawText)
  if (
    normalized.amount === null ||
    !Number.isFinite(normalized.amount) ||
    normalized.amount <= 0 ||
    normalized.unit === 'unknown' ||
    normalized.unit === 'pack' ||
    !Number.isSafeInteger(normalized.count) ||
    normalized.count <= 0
  ) {
    return null
  }

  // Fail closed if the source adapter parsed a different amount or unit.
  // Do not "repair" conflicting observations with an inferred quantity.
  if (pack.amount !== normalized.amount || pack.unit !== normalized.unit) {
    return null
  }

  // Supports future RawPack.count without allowing it to disagree with text.
  if ('count' in pack && pack.count !== normalized.count) return null

  const factor = normalized.unit === 'kg' || normalized.unit === 'l' ? 1000 : 1
  const effectiveBaseAmount = normalized.count * normalized.amount * factor
  if (
    !Number.isFinite(effectiveBaseAmount) ||
    effectiveBaseAmount <= 0 ||
    effectiveBaseAmount > Number.MAX_SAFE_INTEGER
  ) {
    return null
  }

  return {
    packAmount: normalized.amount,
    packUnit: normalized.unit,
    packCount: normalized.count,
  }
}
