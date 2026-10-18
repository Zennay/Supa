import type { BasketTraceLine } from '../../domain/basket.ts'
const euros = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
type Matched = Extract<BasketTraceLine, { status: 'matched' }>

/** Same physical pack basis in a standalone basket and a two-shop ledger.
 * Advisory display only; whole-pack integer cents remain the sole basket authority. */
export function privateUnitPrice(line: Matched): string | null {
  const { amount, count, unit } = line.pack
  const physical = amount * count
  const basis = unit === 'g' || unit === 'ml' ? physical / 1000 : physical
  if (!Number.isFinite(basis) || basis <= 0 ||
      !Number.isSafeInteger(line.pricePerPackCents) || line.pricePerPackCents < 0) return null
  const cents = line.pricePerPackCents / basis
  if (!Number.isFinite(cents) || cents < 0) return null
  const basisLabel = unit === 'g' || unit === 'kg' ? 'kg' :
    unit === 'ml' || unit === 'l' ? 'liter' : 'stuk'
  return euros.format(cents / 100) + ' / ' + basisLabel
}
