import type { BasketTraceLine } from '../../domain/basket.ts'
import type { OwnStore, PrivateReviewedSourceLine } from '../comparison/privateReviewedBasketBridge.ts'

/** The price-free identity of one physical shopping task.
 * Reprice-only edits keep completion, but a new SKU, store, pack or quantity
 * cannot inherit a former checked item. Not retailer approval or payment.
 */
export function privatePhysicalShoppingTick(
  planKey: string, store: OwnStore, storeId: string, line: BasketTraceLine,
): string {
  return JSON.stringify([
    planKey, store, storeId, line.id, line.status,
    line.ingredientLabel, line.requirement.amount, line.requirement.unit,
    line.status === 'matched' ? [
      line.productId, line.productName, line.packs,
      line.pack.amount, line.pack.unit, line.pack.count,
    ] : null,
  ])
}

/** Exact SAME physical shopping key as the fully reviewed source basket.
 * A checked partial line survives completion only when plan, source store,
 * ingredient, original SKU, physical demand and package count all agree.
 * It is never a product review, price authority or store authorization. */
export function privatePartialPhysicalShoppingTick(
  planKey: string, store: OwnStore, line: PrivateReviewedSourceLine,
): string {
  return JSON.stringify([
    planKey, store, store, line.ingredientId, 'matched',
    line.ingredientLabel, line.requiredAmount, line.requiredUnit,
    [line.productId, line.productName, line.packagesNeeded,
      line.packAmount, line.packUnit, line.packCount],
  ])
}
