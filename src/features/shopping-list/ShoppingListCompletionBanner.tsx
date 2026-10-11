import type { OneStoreBasket } from '../../domain/basket.ts'
import { shoppingListCompletion } from './shoppingListCompletion.ts'

type ShoppingListCompletionBannerProps = {
  basket: OneStoreBasket
  doneLineIds: unknown
}

/**
 * Read-only progress: a checked unresolved row remains an open product decision.
 * Integrate from ShoppingListView using its current basket-scoped done IDs;
 * this component intentionally never reads storage or mutates basket state.
 */
export function ShoppingListCompletionBanner({
  basket,
  doneLineIds,
}: ShoppingListCompletionBannerProps) {
  const completion = shoppingListCompletion(basket, doneLineIds)

  return (
    <div
      className={completion.state === 'review-needed' || completion.state === 'invalid'
        ? 'attention-card'
        : 'insight-card'}
      role="status"
      aria-live="polite"
      data-shopping-progress-state={completion.state}
    >
      <strong>{completion.message}</strong>
      {completion.followUp !== null && <span>{completion.followUp}</span>}
    </div>
  )
}
