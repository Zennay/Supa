import { observedInstant } from '../../domain/offlineReviewedImport.ts'
import { confirmedPartialBasket } from '../planner/confirmedPartialBasket.ts'
import {
  recentOwnCaptureInstant, type OwnStore, type PrivateCaptureProgress,
  type PrivateReviewedSourceLine,
} from '../comparison/privateReviewedBasketBridge.ts'

export type PrivateProgressProductRow = {
  store: OwnStore
  observedAt: string
  line: PrivateReviewedSourceLine
}
const shops: readonly OwnStore[] = ['PLUS', 'DekaMarkt']

/** Only receipt-bound, individually confirmed source facts from this Planner
 * week. No incomplete basket may become a priced whole-basket authority.
 */
export function privateProgressProductRows(
  progress: PrivateCaptureProgress | null, now: number,
): PrivateProgressProductRow[] {
  if (!progress || !Number.isSafeInteger(now)) return []
  return shops.flatMap(store => {
    const capture = progress.stores[store]
    // The shopping-list source bridge already enforces exact original
    // SKU uniqueness, physical pack/demand arithmetic and cent-safe sums.
    // Treat that ONE admission as the source of truth in Home, Producten and
    // Planner rather than rendering rows a partial shopping list rejects.
    const certified = confirmedPartialBasket(progress, store, now)
    if (!capture || !certified ||
        certified.confirmedCount !== capture.confirmedSourceLines?.length ||
        certified.confirmedCount > certified.physicalLineCount) return []
    return capture.confirmedSourceLines!.map(line => ({
      store, observedAt: capture.observedAt, line,
    }))
  })
}

export type PrivateProgressPricePair = {
  one: PrivateReviewedSourceLine
  other: PrivateReviewedSourceLine
  difference: number
}

/** Strict original timestamp pairing and identical physical needs.
 * Returns ONLY comparable lines, never a subtotal or a store winner.
 */
export function privateProgressPricePairs(
  progress: PrivateCaptureProgress | null, now: number,
): PrivateProgressPricePair[] {
  const plus = progress?.stores.PLUS
  const deka = progress?.stores.DekaMarkt
  if (!plus || !deka || !plus.fresh || !deka.fresh ||
      !recentOwnCaptureInstant(plus.observedAt, now) ||
      !recentOwnCaptureInstant(deka.observedAt, now)) return []
  const left = observedInstant(plus.observedAt)
  const right = observedInstant(deka.observedAt)
  if (!left || !right ||
      (left.ns >= right.ns ? left.ns - right.ns : right.ns - left.ns) >
      86_400_000_000_000n) return []
  const rows = privateProgressProductRows(progress, now)
  const dekaRows = new Map(rows.filter(row => row.store === 'DekaMarkt')
    .map(row => [row.line.ingredientId, row.line]))
  return rows.filter(row => row.store === 'PLUS').flatMap(row => {
    const one = row.line
    const other = dekaRows.get(one.ingredientId)
    if (!other || one.requiredAmount !== other.requiredAmount ||
        one.requiredUnit !== other.requiredUnit ||
        one.ingredientLabel !== other.ingredientLabel) return []
    const difference = other.lineTotalCents - one.lineTotalCents
    return Number.isSafeInteger(difference) ? [{ one, other, difference }] : []
  })
}
