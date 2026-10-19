import type { BasketTraceLine } from '../../domain/basket.ts'
const euros = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
type Matched = Extract<BasketTraceLine, { status: 'matched' }>

/** Physical pack rate, shared by Producten, single-store and paired ledgers.
 * Display-only: matched basket money remains exact whole-pack integer cents. */
export function privatePackUnitRate(pack: {
  amount: number | null
  unit: string
  count: number
  priceCents: number | null
}): { unit: 'kg' | 'liter' | 'stuk'; centsPerUnit: number } | null {
  if (!['g', 'kg', 'ml', 'l', 'piece'].includes(pack.unit)) return null
  if (pack.amount === null || !Number.isFinite(pack.amount) || pack.amount <= 0 ||
      !Number.isSafeInteger(pack.count) || pack.count <= 0 ||
      pack.priceCents === null || !Number.isSafeInteger(pack.priceCents) ||
      pack.priceCents < 0) return null
  const physical = pack.amount * pack.count
  const basis = pack.unit === 'g' || pack.unit === 'ml' ? physical / 1000 : physical
  if (!Number.isFinite(basis) || basis <= 0) return null
  const centsPerUnit = pack.priceCents / basis
  if (!Number.isFinite(centsPerUnit) || centsPerUnit < 0) return null
  return { unit: pack.unit === 'g' || pack.unit === 'kg' ? 'kg' :
    pack.unit === 'ml' || pack.unit === 'l' ? 'liter' : 'stuk', centsPerUnit }
}

export function privateUnitPrice(line: Matched): string | null {
  const rate = privatePackUnitRate({ amount: line.pack.amount,
    unit: line.pack.unit, count: line.pack.count, priceCents: line.pricePerPackCents })
  return rate ? euros.format(rate.centsPerUnit / 100) + ' / ' + rate.unit : null
}
