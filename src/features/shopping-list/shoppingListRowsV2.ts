import type { OneStoreBasket } from '../../domain/basket.ts'
import { shoppingListDemandIdentity } from './shoppingListDemandIdentity.ts'
import { quantityUnitLabelNl } from '../../lib/quantityPresentation.ts'
import type { ShoppingProgressSessionV2 } from './shoppingListProgressSessionV2.ts'

export type ShoppingRowV2 = Readonly<{
  id: string
  label: string
  quantity: string
  checked: boolean
  unresolved: boolean
}>

/**
 * Build display-only rows. Never infer money or saved progress from a rendered
 * price: the pinned physical-demand key is the authority for checkmarks.
 *
 * The caller may briefly render with the previous session while React is
 * rebasing a new basket prop. Suppress stale checks synchronously in that frame.
 */
export function shoppingListRowsV2(
  basket: OneStoreBasket,
  session: ShoppingProgressSessionV2,
): readonly ShoppingRowV2[] {
  const identity = shoppingListDemandIdentity(basket)
  if (identity === null) return []

  const checked = new Set(
    session.demandIdentity === identity ? session.completedLineIds : [],
  )

  return basket.lines.map((line) => {
    if (line.status === 'unresolved') {
      return {
        id: line.id,
        label: line.ingredientLabel,
        quantity: `${line.requirement.amount ?? '?'} ${quantityUnitLabelNl(line.requirement.unit, line.requirement.amount)} · handmatig kiezen`,
        checked: checked.has(line.id),
        unresolved: true,
      }
    }

    const packPrefix = line.pack.count > 1 ? `${line.pack.count} × ` : ''
    return {
      id: line.id,
      label: line.productName,
      quantity: `${line.packs} × ${packPrefix}${line.pack.amount} ${quantityUnitLabelNl(line.pack.unit, line.pack.amount)}`,
      checked: checked.has(line.id),
      unresolved: false,
    }
  })
}
