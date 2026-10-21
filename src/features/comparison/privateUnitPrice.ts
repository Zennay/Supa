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

/**
 * This exported display API may also be invoked from plain JavaScript.
 * Snapshot own ordinary data descriptors only; never execute getters,
 * inherited values or a Proxy's throwing descriptor trap as price facts.
 */
function ownData(value: unknown, name: string): unknown {
  if (value === null || typeof value !== 'object') return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, name)
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? descriptor.value : undefined
}

function readonlyPricePack(value: unknown): {
  amount: number | null; unit: string; count: number; priceCents: number | null
} | null {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
    const amount = ownData(value, 'amount')
    const unit = ownData(value, 'unit')
    const count = ownData(value, 'count')
    const priceCents = ownData(value, 'priceCents')
    if ((amount !== null && typeof amount !== 'number') ||
        typeof unit !== 'string' || typeof count !== 'number' ||
        (priceCents !== null && typeof priceCents !== 'number')) return null
    return { amount, unit, count, priceCents } as {
      amount: number | null; unit: string; count: number; priceCents: number | null
    }
  } catch { return null }
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
  const captured = readonlyPricePack(pack)
  if (!captured) return null
  if (!['g', 'kg', 'ml', 'l', 'piece'].includes(captured.unit) ||
      captured.amount === null ||
      !Number.isSafeInteger(captured.count) || captured.count <= 0 ||
      captured.priceCents === null || !Number.isSafeInteger(captured.priceCents) ||
      captured.priceCents < 0) return null
  const quantity = decimalQuantity(captured.amount)
  if (!quantity) return null
  const factor = captured.unit === 'g' || captured.unit === 'ml' ? 1000n : 1n
  const numerator = BigInt(captured.priceCents) * factor * quantity.scale
  const denominator = quantity.numerator * BigInt(captured.count)
  if (denominator <= 0n) return null

  const centsPerUnit = Number(numerator) / Number(denominator)
  const roundedCents = (2n * numerator + denominator) / (2n * denominator)
  const milliCents = (2000n * numerator + denominator) / (2n * denominator)
  const max = BigInt(Number.MAX_SAFE_INTEGER)
  if (!Number.isFinite(centsPerUnit) || centsPerUnit < 0 ||
      roundedCents > max || milliCents > max) return null
  return {
    unit: captured.unit === 'g' || captured.unit === 'kg' ? 'kg' :
      captured.unit === 'ml' || captured.unit === 'l' ? 'liter' : 'stuk',
    centsPerUnit,
    roundedCentsPerUnit: Number(roundedCents),
    milliCentsPerUnit: Number(milliCents),
  }
}

/** Locale-safe euro display; no floating-point intermediate to round cents. */
export function formatPrivateUnitRate(rate: PrivateUnitRate): string {
  return euros.format(rate.roundedCentsPerUnit / 100) + ' / ' + rate.unit
}

/** Advisory €/kg, €/liter or €/stuk for an already selected, full-pack route line.
 * Read only ordinary own data, as with canonical unit-price presentation. */
export function privateMixedStoreUnitPrice(line: unknown): string | null {
  try {
    const rate = privatePackUnitRate({
      amount: ownData(line, 'packAmount') as number | null,
      unit: ownData(line, 'packUnit') as string,
      count: ownData(line, 'packCount') as number,
      priceCents: ownData(line, 'pricePerPackCents') as number | null,
    })
    return rate ? formatPrivateUnitRate(rate) : null
  } catch { return null }
}

export function privateUnitPrice(line: Matched): string | null {
  try {
    // Do not dereference a foreign BasketTraceLine's nested pack getters.
    // Only actual own monetary and physical values can reach the already
    // bounded, read-only one-package unit-rate formatter.
    const rawPack = ownData(line, 'pack')
    const rate = privatePackUnitRate({
      amount: ownData(rawPack, 'amount') as number | null,
      unit: ownData(rawPack, 'unit') as string,
      count: ownData(rawPack, 'count') as number,
      priceCents: ownData(line, 'pricePerPackCents') as number | null,
    })
    return rate ? formatPrivateUnitRate(rate) : null
  } catch { return null }
}
