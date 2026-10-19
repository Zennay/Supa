import type { PlannedMeal } from '../../domain/types.ts'
import {
  buildOneStoreBasket, type RecipeWithIngredients,
} from '../../domain/basket.ts'
import { compareFullBaskets } from '../../domain/basketComparison.ts'
import type { OfflinePriceSnapshots, OfflineRetailer } from '../../domain/offlineReviewedImport.ts'
import type { OfflineComparisonSession } from './offlineComparisonSession.ts'

const stores: OfflineRetailer[] = ['PLUS', 'DekaMarkt']

/** Price/plan identity for manually verified product choices, on either tab. */
export function offlineSessionFingerprint(
  imported: OfflinePriceSnapshots | null,
  plan: PlannedMeal[], recipes: RecipeWithIngredients[], activeDays: string[],
): string {
  if (!imported) return ''
  return JSON.stringify([
    plan, activeDays,
    recipes.map(recipe => [recipe.id, recipe.ingredients]),
    ...stores.map(store => [
      imported.captures[store].observedAt,
      imported.captures[store].products,
    ]),
  ])
}

/** Never use matches from an earlier import or an earlier week menu. */
export function offlineSessionBaskets(
  session: OfflineComparisonSession,
  plan: PlannedMeal[], recipes: RecipeWithIngredients[], activeDays: string[],
) {
  const imported = session.imported
  if (!imported) return null
  try {
    const identity = offlineSessionFingerprint(imported, plan, recipes, activeDays)
    const choices = session.manualSelections.fingerprint === identity
      ? session.manualSelections.products : {}
    const basket = (store: OfflineRetailer) => {
      const prefix = store + '\u0000'
      const manualProductIds = Object.fromEntries(
        Object.entries(choices).filter(([id]) => id.startsWith(prefix))
          .map(([id, productId]) => [id.slice(prefix.length), productId]),
      )
      return buildOneStoreBasket({
        store: { id: store, name: store },
        plan, recipes, activeDays,
        products: imported.captures[store].products,
        manualProductIds,
      })
    }
    const plus = basket('PLUS')
    const deka = basket('DekaMarkt')
    return { plus, deka, comparison: compareFullBaskets({ baseline: plus, candidate: deka }) }
  } catch { return null }
}

/** Recompute freshness against the wall clock; a cached upload never extends its expiry. */
export function offlineSessionFresh(imported: OfflinePriceSnapshots, nowMs: number) {
  const nowNs = BigInt(Math.trunc(nowMs)) * 1_000_000n
  const plus = imported.captures.PLUS.observedNs
  const deka = imported.captures.DekaMarkt.observedNs
  const oldest = plus < deka ? plus : deka
  const newest = plus > deka ? plus : deka
  return nowNs >= newest - 300_000_000_000n &&
    nowNs - oldest <= 604_800_000_000_000n
}
