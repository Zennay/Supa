/**
 * Presentation-only helpers for the original Figma Producten screen (3064:3125).
 * Values here describe Figma EXAMPLES, not sourced retailer prices.
 *
 * A €/kg amount is never directly compared with a €/l amount. The original
 * first-seen unit group stays first; items are only ordered within a group.
 */
export type DemoPriceUnit = 'l' | 'kg'
export type DemoUnitFilter = 'all' | DemoPriceUnit

export function parseDemoUnitPrice(value: string): { unit: DemoPriceUnit; cents: number } | null {
  const match = /^\s*€\s*(\d+(?:[.,]\d{1,2})?)\s*\/\s*(l|kg)\s*$/i.exec(value)
  if (!match) return null
  const cents = Math.round(Number(match[1].replace(',', '.')) * 100)
  if (!Number.isSafeInteger(cents) || cents < 0) return null
  return { unit: match[2].toLowerCase() as DemoPriceUnit, cents }
}

export function filterDemoProductsByUnit<T extends { unitPrice: string }>(
  products: readonly T[],
  unit: DemoUnitFilter,
): T[] {
  return products.filter(product => unit === 'all' || parseDemoUnitPrice(product.unitPrice)?.unit === unit)
}

export function orderDemoProductsByUnitPrice<T extends { unitPrice: string }>(
  products: readonly T[],
): T[] {
  const groups = new Map<string, { product: T; cents: number | null; originalIndex: number }[]>()
  products.forEach((product, originalIndex) => {
    const parsed = parseDemoUnitPrice(product.unitPrice)
    const key = parsed?.unit ?? 'unknown'
    const group = groups.get(key) ?? []
    group.push({ product, cents: parsed?.cents ?? null, originalIndex })
    groups.set(key, group)
  })
  return [...groups.values()].flatMap(group =>
    group.sort((a, b) =>
      (a.cents ?? Infinity) - (b.cents ?? Infinity) || a.originalIndex - b.originalIndex,
    ).map(item => item.product),
  )
}
