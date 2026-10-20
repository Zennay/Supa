import { observedInstant } from '../../domain/offlineReviewedImport.ts'
import { privatePackUnitRate, formatPrivateUnitRate } from '../comparison/privateUnitPrice.ts'
import type { BasketTraceLine } from '../../domain/basket.ts'
import { confirmedPartialBasket } from '../planner/confirmedPartialBasket.ts'
import {
  recentOwnCaptureInstant, freshReviewedBaskets, type OwnStore, type PrivateCaptureProgress,
  type PrivateReviewedBaskets,
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


/** Same physical ingredient, two independently confirmed own-source prices.
 * An incomplete store can provide a line delta but never a full-basket winner.
 */
export type PrivateKnownProduct = {
  productId: string
  productName: string
  packAmount: number
  packUnit: string
  packCount: number
  pricePerPackCents: number
  unitRate: string | null
}

function knownProduct(value: {
  productId: string; productName: string; packAmount: number;
  packUnit: string; packCount: number; pricePerPackCents: number
}): PrivateKnownProduct {
  const rate = privatePackUnitRate({ amount: value.packAmount,
    unit: value.packUnit, count: value.packCount, priceCents: value.pricePerPackCents })
  return { ...value, unitRate: rate ? formatPrivateUnitRate(rate) : null }
}

function originalCompleteProduct(line: Extract<BasketTraceLine, { status: 'matched' }>): PrivateKnownProduct {
  return knownProduct({ productId: line.productId, productName: line.productName,
    packAmount: line.pack.amount, packUnit: line.pack.unit, packCount: line.pack.count,
    pricePerPackCents: line.pricePerPackCents })
}

function originalPartialProduct(line: PrivateReviewedSourceLine): PrivateKnownProduct {
  return knownProduct({ productId: line.productId, productName: line.productName,
    packAmount: line.packAmount, packUnit: line.packUnit, packCount: line.packCount,
    pricePerPackCents: line.pricePerPackCents })
}

export type PrivateKnownPricePair = {
  ingredientId: string
  plusCents: number
  dekaCents: number
  plusPacks: number
  dekaPacks: number
  difference: number
  basis: 'partial-pair' | 'complete-and-partial'
  plusObservedAt: string
  dekaObservedAt: string
  plusProduct: PrivateKnownProduct
  dekaProduct: PrivateKnownProduct
}

export function privateKnownPricePairs(
  progress: PrivateCaptureProgress | null,
  reviewed: PrivateReviewedBaskets | null,
  now: number,
): PrivateKnownPricePair[] {
  if (!progress || !Number.isSafeInteger(now) ||
      (reviewed && progress.planKey !== reviewed.planKey)) return []
  const result = new Map<string, PrivateKnownPricePair>()
  const complete = freshReviewedBaskets(reviewed, progress.planKey, now)
  // When one store is already fully reviewed, compare against that ORIGINAL
  // admitted receipt. An older progress snapshot must not compete with it.
  if (!complete?.stores.PLUS && !complete?.stores.DekaMarkt)
  for (const pair of privateProgressPricePairs(progress, now)) {
    result.set(pair.one.ingredientId, {
      ingredientId: pair.one.ingredientId,
      plusCents: pair.one.lineTotalCents,
      dekaCents: pair.other.lineTotalCents,
      plusPacks: pair.one.packagesNeeded,
      dekaPacks: pair.other.packagesNeeded,
      difference: pair.difference,
      basis: 'partial-pair',
      plusObservedAt: progress.stores.PLUS!.observedAt,
      dekaObservedAt: progress.stores.DekaMarkt!.observedAt,
      plusProduct: originalPartialProduct(pair.one),
      dekaProduct: originalPartialProduct(pair.other),
    })
  }
  if (!complete) return [...result.values()]
  const partialRows = privateProgressProductRows(progress, now)
  for (const completeStore of shops) {
    const receipt = complete.stores[completeStore]
    const otherStore: OwnStore = completeStore === 'PLUS' ? 'DekaMarkt' : 'PLUS'
    const partialCapture = progress.stores[otherStore]
    if (!receipt || complete.stores[otherStore] || !partialCapture ||
        partialCapture.demandLineCount !== receipt.basket.lines.length) continue
    // Preserve nanosecond precision: an original time just outside 24h
    // cannot be laundered through Date.parse millisecond rounding.
    const left = observedInstant(receipt.observedAt)
    const right = observedInstant(partialCapture.observedAt)
    if (!left || !right || left.ms !== receipt.capturedMs ||
        (left.ns >= right.ns ? left.ns - right.ns : right.ns - left.ns) >
          86_400_000_000_000n) continue
    const completeLines = new Map(receipt.basket.lines.map(line => [line.id, line]))
    for (const { store, line } of partialRows) {
      if (store !== otherStore) continue
      const original = completeLines.get(line.ingredientId)
      if (!original || original.status !== 'matched' ||
          original.ingredientLabel !== line.ingredientLabel ||
          original.requirement.amount !== line.requiredAmount ||
          original.requirement.unit !== line.requiredUnit) continue
      const plusCents = completeStore === 'PLUS'
        ? original.lineTotalCents : line.lineTotalCents
      const dekaCents = completeStore === 'DekaMarkt'
        ? original.lineTotalCents : line.lineTotalCents
      const difference = dekaCents - plusCents
      if (!Number.isSafeInteger(difference)) continue
      result.set(line.ingredientId, {
        ingredientId: line.ingredientId,
        plusCents, dekaCents,
        plusPacks: completeStore === 'PLUS' ? original.packs : line.packagesNeeded,
        dekaPacks: completeStore === 'DekaMarkt' ? original.packs : line.packagesNeeded,
        difference, basis: 'complete-and-partial',
        plusObservedAt: completeStore === 'PLUS' ? receipt.observedAt : partialCapture.observedAt,
        dekaObservedAt: completeStore === 'DekaMarkt' ? receipt.observedAt : partialCapture.observedAt,
        plusProduct: completeStore === 'PLUS'
          ? originalCompleteProduct(original) : originalPartialProduct(line),
        dekaProduct: completeStore === 'DekaMarkt'
          ? originalCompleteProduct(original) : originalPartialProduct(line),
      })
    }
  }
  return [...result.values()]
}
