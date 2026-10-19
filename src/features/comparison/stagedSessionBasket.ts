import type { PlannedMeal } from '../../domain/types.ts'
import { buildOneStoreBasket, type RecipeWithIngredients } from '../../domain/basket.ts'
import { parseSingleOfflineCapture, type OfflineRetailer } from '../../domain/offlineReviewedImport.ts'
import type { OfflineComparisonSession } from './offlineComparisonSession.ts'
import { stagedStoreFingerprint } from './stagedStoreFingerprint.ts'

/** Resolve only canonically admitted local source bytes. No synthetic partner,
 * current-price attestation, network fetch, or stale reviewed-match reuse. */
export function resolveStagedBasket(
  session: OfflineComparisonSession, store: OfflineRetailer,
  plan: PlannedMeal[], recipes: RecipeWithIngredients[],
  activeDays: string[], clockMs: number,
) {
  const capture = session.stagedCaptures[store]
  if (!capture) return null
  try {
    const source = parseSingleOfflineCapture(JSON.stringify({
      schema: 'supa-offline-store-capture-v1', capture,
    }), clockMs).normalized
    if (source.retailer !== store) return null
    const fingerprint = stagedStoreFingerprint(capture, plan, recipes, activeDays)
    const manual = session.stagedManual[store]
    const choices = manual.fingerprint === fingerprint ? manual.products : {}
    const basket = buildOneStoreBasket({
      store: { id: store, name: store },
      plan, recipes, activeDays, products: source.products,
      manualProductIds: choices,
    })
    const now = BigInt(Math.trunc(clockMs)) * 1_000_000n
    const fresh = now >= source.observedNs - 300_000_000_000n &&
      now - source.observedNs <= 604_800_000_000_000n
    return { store, basket, fresh, source }
  } catch { return null }
}
