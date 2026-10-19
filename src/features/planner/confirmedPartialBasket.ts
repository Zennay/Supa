import { recentOwnCaptureInstant, type PrivateCaptureProgress, type OwnStore } from '../comparison/privateReviewedBasketBridge.ts'

export type ConfirmedPartialBasket = {
  confirmedCount: number
  physicalLineCount: number
  knownCents: number
  remainingCount: number
}

/**
 * Progress-only disclosure for a STILL-INCOMPLETE store. It is deliberately
 * not a complete OneStoreBasket, not used by budgets, routing or comparisons.
 * No amount is inferred from unresolved rows, offers or other stores.
 */
export function confirmedPartialBasket(
  progress: PrivateCaptureProgress | null,
  store: OwnStore,
  now: number,
): ConfirmedPartialBasket | null {
  if (!progress || !Number.isSafeInteger(now)) return null
  const capture = progress.stores[store]
  if (!capture || !capture.fresh ||
      !recentOwnCaptureInstant(capture.observedAt, now)) return null
  const rows = capture.confirmedSourceLines
  const physicalLineCount = capture.demandLineCount
  if (!Array.isArray(rows) || !rows.length ||
      !Number.isSafeInteger(physicalLineCount) || physicalLineCount < 1 ||
      !Number.isSafeInteger(capture.reviewedLineCount) ||
      capture.reviewedLineCount < rows.length || rows.length > physicalLineCount ||
      rows.length > 1000) return null
  const ids = new Set<string>()
  // A single purchased SKU cannot be charged independently for two different
  // physical needs: multiple recipes may share one real package.
  const physicalSkus = new Set<string>()
  let knownCents = 0
  for (const line of rows) {
    if (!line || typeof line.ingredientId !== 'string' || !line.ingredientId ||
        ids.has(line.ingredientId) ||
        typeof line.productId !== 'string' || !line.productId ||
        physicalSkus.has(line.productId) ||
        typeof line.ingredientLabel !== 'string' || !line.ingredientLabel ||
        !Number.isFinite(line.requiredAmount) || line.requiredAmount <= 0 ||
        !['g', 'kg', 'ml', 'l', 'piece'].includes(line.requiredUnit) ||
        !Number.isFinite(line.packAmount) || line.packAmount <= 0 ||
        !['g', 'kg', 'ml', 'l', 'piece'].includes(line.packUnit) ||
        !Number.isSafeInteger(line.packCount) || line.packCount < 1 ||
        !Number.isSafeInteger(line.packagesNeeded) || line.packagesNeeded < 1 ||
        !Number.isSafeInteger(line.pricePerPackCents) || line.pricePerPackCents < 0 ||
        !Number.isSafeInteger(line.lineTotalCents) || line.lineTotalCents < 0 ||
        line.packagesNeeded * line.pricePerPackCents !== line.lineTotalCents) return null
    ids.add(line.ingredientId)
    physicalSkus.add(line.productId)
    knownCents += line.lineTotalCents
    if (!Number.isSafeInteger(knownCents)) return null
  }
  if (ids.size !== rows.length) return null
  return {
    confirmedCount: rows.length,
    physicalLineCount,
    knownCents,
    remainingCount: physicalLineCount - rows.length,
  }
}
