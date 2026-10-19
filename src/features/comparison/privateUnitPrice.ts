import type { BasketTraceLine } from '../../domain/basket.ts'
const euros = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
type Matched = Extract<BasketTraceLine, { status: 'matched' }>

type PrivateUnitRate = {
  unit: 'kg' | 'liter' | 'stuk'
  // Unrounded advisory rate, used ONLY for ordering original priced articles.
  centsPerUnit: number
  // Exact decimal half-up presentation; not the canonical basket cost.
  roundedCentsPerUnit: number
  milliCentsPerUnit: number
}

// Convert a human-authored decimal (including scientific notation) to a
// bounded rational, rather than multiplying/rounding binary fractions.
function decimalQuantity(value: number): { numerator: bigint; scale: bigint } | null {
  if (!Number.isFinite(value) || value <= 0) return null
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(String(value))
  if (!match) return null
  const fraction = match[2] ?? ''
  const exponent = Number(match[3] ?? 0)
  const places = fraction.length - exponent
  if (!Number.isSafeInteger(exponent) || Math.abs(places) > 18 ||
      match[1].length + fraction.length > 40) return null
  const coefficient = BigInt(match[1] + fraction)
  if (!coefficient) return null
  return places >= 0
    ? { numerator: coefficient, scale: 10n ** BigInt(places) }
    : { numerator: coefficient * 10n ** BigInt(-places), scale: 1n }
}

/** Presentation-only €/kg, €/liter or €/piece from one real captured pack.
 * The paid-for basket always uses separately validated whole-pack cent totals.
 * An unrepresentable quantity/rate stays unknown; never substitute €0. */
export function privatePackUnitRate(pack: {
  amount: number | null
  unit: string
  count: number
  priceCents: number | null
}): PrivateUnitRate | null {
  if (!['g', 'kg', 'ml', 'l', 'piece'].includes(pack.unit) ||
      pack.amount === null ||
      !Number.isSafeInteger(pack.count) || pack.count <= 0 ||
      pack.priceCents === null || !Number.isSafeInteger(pack.priceCents) ||
      pack.priceCents < 0) return null
  const quantity = decimalQuantity(pack.amount)
  if (!quantity) return null
  const factor = pack.unit === 'g' || pack.unit === 'ml' ? 1000n : 1n
  const numerator = BigInt(pack.priceCents) * factor * quantity.scale
  const denominator = quantity.numerator * BigInt(pack.count)
  if (denominator <= 0n) return null

  const centsPerUnit = Number(numerator) / Number(denominator)
  const roundedCents = (2n * numerator + denominator) / (2n * denominator)
  const milliCents = (2000n * numerator + denominator) / (2n * denominator)
  const max = BigInt(Number.MAX_SAFE_INTEGER)
  if (!Number.isFinite(centsPerUnit) || centsPerUnit < 0 ||
      roundedCents > max || milliCents > max) return null
  return {
    unit: pack.unit === 'g' || pack.unit === 'kg' ? 'kg' :
      pack.unit === 'ml' || pack.unit === 'l' ? 'liter' : 'stuk',
    centsPerUnit,
    roundedCentsPerUnit: Number(roundedCents),
    milliCentsPerUnit: Number(milliCents),
  }
}

/** Locale-safe euro display; no floating-point intermediate to round cents. */
export function formatPrivateUnitRate(rate: PrivateUnitRate): string {
  return euros.format(rate.roundedCentsPerUnit / 100) + ' / ' + rate.unit
}

export function privateUnitPrice(line: Matched): string | null {
  const rate = privatePackUnitRate({ amount: line.pack.amount,
    unit: line.pack.unit, count: line.pack.count, priceCents: line.pricePerPackCents })
  return rate ? formatPrivateUnitRate(rate) : null
}
