import type { StoreProduct } from '../../domain/basket.ts'
import type { MatchUnit } from '../../domain/matching.ts'

const fold = (v: string) => v.normalize('NFKD')
  .replace(/\p{M}/gu, '').toLocaleLowerCase('nl')
const words = (v: string) => fold(v).match(/[\p{L}\p{N}]+/gu) ?? []
const scale = (unit: MatchUnit) => unit === 'kg' || unit === 'l' ? 1000 : 1

/**
 * Rank *existing, owner-supplied* product records for manual selection.
 * Never auto-approve a product, alter its price, or infer a source receipt.
 * Cheapness does NOT count as identity evidence.
 */
export function rankOwnSourceSuggestions(
  products: readonly StoreProduct[], ingredient: string, amount: number | null,
  unit: MatchUnit, search = '',
): StoreProduct[] {
  const ingredientName = fold(ingredient).trim()
  const tokens = [...new Set(words(ingredient).filter(w =>
    w.length > 1 && !['een', 'de', 'het', 'van', 'voor'].includes(w)))]
  const searchText = fold(search).trim()
  const rank = (p: StoreProduct) => {
    const name = fold(p.name)
    const named = new Set(words(p.name))
    let value = ingredientName.length >= 3 && name.includes(ingredientName) ? 120 : 0
    value += tokens.filter(t => named.has(t) || (t.length >= 4 && name.includes(t))).length * 25
    if (searchText && fold(p.id) === searchText) value += 250
    if (searchText && name.startsWith(searchText)) value += 50
    if (amount !== null && Number.isFinite(amount) && amount > 0 &&
        p.packAmount !== null && p.packAmount > 0 && Number.isFinite(p.packAmount)) {
      const compatible = unit === p.packUnit ||
        (['g', 'kg'].includes(unit) && ['g', 'kg'].includes(p.packUnit)) ||
        (['ml', 'l'].includes(unit) && ['ml', 'l'].includes(p.packUnit))
      if (compatible) {
        const ratio = (p.packAmount * (p.packCount ?? 1) * scale(p.packUnit)) /
          (amount * scale(unit))
        value += ratio >= 1 && ratio <= 2 ? 9 : ratio > 0.5 && ratio < 1 ? 5 : 0
      }
    }
    return value
  }
  return [...products].sort((a, b) => rank(b) - rank(a) ||
    a.name.localeCompare(b.name, 'nl') || a.id.localeCompare(b.id, 'nl'))
}
