import type { OneStoreBasket } from '../../domain/basket.ts'

type ShoppingLine = OneStoreBasket['lines'][number]

/**
 * A view-only projection for the in-store checklist.
 * It never modifies line identity, physical pack facts, saved checks or copy.
 * Unknown product choices remain open for review in the completion banner.
 */
export function shoppingVisibleLines(
  lines: readonly ShoppingLine[],
  doneLineIds: readonly string[],
  openOnly: boolean,
): ShoppingLine[] {
  if (!Array.isArray(lines) || !Array.isArray(doneLineIds)) return []
  if (!openOnly) return [...lines]
  const checkedIds = new Set(doneLineIds.filter((id) => typeof id === 'string'))
  return lines.filter((line) => !checkedIds.has(line.id))
}
