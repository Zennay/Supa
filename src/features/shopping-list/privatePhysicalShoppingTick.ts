import type { BasketTraceLine } from '../../domain/basket.ts'
import type { OwnStore } from '../comparison/privateReviewedBasketBridge.ts'

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
