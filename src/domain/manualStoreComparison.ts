import { calculateDecimalPackCount } from './decimalPackArithmetic.ts'
import type { MatchUnit } from './matching.ts'

export type ManualNeed = Readonly<{ id: string; label: string; amount: number | null; unit: MatchUnit }>
export type ManualRetailer = 'PLUS' | 'DekaMarkt'
export type ManualQuote = Readonly<{
  product: string
  packAmount: string
  packUnit: MatchUnit | ''
  /** Explicit count of units inside one physically priced multipack. */
  packCount?: string
  price: string
}>
export type ManualEntries = Record<string, ManualQuote>
export type ManualLine = Readonly<{
  ingredientId: string
  label: string
  requiredAmount: number | null
  requiredUnit: MatchUnit
  quotes: Readonly<Record<ManualRetailer, Readonly<{
    state: 'missing' | 'invalid' | 'complete'
    packs: number | null
    lineCents: number | null
    unitPriceCents: number | null
  }>>>
}>
export type ManualComparison = Readonly<{
  rows: readonly ManualLine[]
  missing: number
  invalid: number
  complete: number
  fullBasket: boolean
  totals: Readonly<Record<ManualRetailer, number | null>>
  deltaCents: number | null
  cheaper: ManualRetailer | null
  source: 'own-unverified-entries'
  publicSavingsClaimEligible: false
  productionEnabled: false
}>

export const MANUAL_RETAILERS = ['PLUS', 'DekaMarkt'] as const
const UNITS: ReadonlySet<MatchUnit> = new Set(['g', 'kg', 'ml', 'l', 'piece'])
const unitsFor = (unit: MatchUnit): readonly MatchUnit[] =>
  unit === 'g' || unit === 'kg' ? ['g', 'kg'] :
  unit === 'ml' || unit === 'l' ? ['ml', 'l'] :
  unit === 'piece' ? ['piece'] : []

export function manualQuoteKey(retailer: ManualRetailer, ingredientId: string): string {
  return JSON.stringify([retailer, ingredientId])
}
export function manualCompatibleUnits(unit: MatchUnit): readonly MatchUnit[] {
  return unitsFor(unit)
}
const amountValue = (raw: string): number | null => {
  if (typeof raw !== 'string' || !/^(?:[1-9]\d{0,5}|0)(?:[.,]\d{1,6})?$/.test(raw.trim())) return null
  const number = Number(raw.trim().replace(',', '.'))
  return Number.isFinite(number) && number > 0 && number <= 100000 ? number : null
}
export function manualPriceCents(raw: string): number | null {
  if (typeof raw !== 'string' || !/^(?:0|[1-9]\d{0,3})(?:[.,]\d{1,2})?$/.test(raw.trim())) return null
  const [euro, fraction = ''] = raw.trim().replace(',', '.').split('.')
  const cents = Number(euro) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 999999 ? cents : null
}

/** Exact half-up cent rate for an entered physical multipack, without binary float rounding.
 * Whole-pack basket cents remain the sole authority for store totals. */
function exactManualUnitPriceCents(
  rawAmount: string, unit: MatchUnit, count: number, cents: number,
): number | null {
  const [whole, fraction = ''] = rawAmount.trim().replace(',', '.').split('.')
  if (!/^(?:0|[1-9]\d{0,5})$/.test(whole) || !/^\d{0,6}$/.test(fraction) ||
      !Number.isSafeInteger(count) || count < 1 ||
      !Number.isSafeInteger(cents) || cents < 0) return null
  const quantity = BigInt(whole + fraction)
  const baseFactor = unit === 'kg' || unit === 'l' ? 1000n : 1n
  const rateFactor = unit === 'piece' ? 1n : 1000n
  const denominator = quantity * baseFactor * BigInt(count)
  if (denominator <= 0n) return null
  const numerator = BigInt(cents) * rateFactor * 10n ** BigInt(fraction.length)
  const roundedCents = (2n * numerator + denominator) / (2n * denominator)
  return roundedCents <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(roundedCents) : null
}

function evaluatedQuote(need: ManualNeed, quote: ManualQuote | undefined) {
  const empty = { state: 'missing' as const, packs: null, lineCents: null, unitPriceCents: null }
  if (!quote || !quote.product.trim() && !quote.packAmount.trim() && !quote.price.trim()) return empty
  const amount = amountValue(quote.packAmount)
  const countRaw = quote.packCount ?? ''
  const count = /^(?:[1-9]\d{0,2}|1000)$/.test(countRaw) ? Number(countRaw) : null
  const cents = manualPriceCents(quote.price)
  const name = quote.product.trim()
  if (need.amount === null || !Number.isFinite(need.amount) || need.amount <= 0 ||
      name.length < 2 || name.length > 160 || /[\u0000-\u001f\u007f]/u.test(name) ||
      !unitsFor(need.unit).includes(quote.packUnit as MatchUnit) ||
      amount === null || count === null || cents === null) {
    return { state: 'invalid' as const, packs: null, lineCents: null, unitPriceCents: null }
  }
  const packs = calculateDecimalPackCount(
    [{ amount: need.amount, unit: need.unit }],
    { amount, unit: quote.packUnit as MatchUnit, count },
  )
  if (packs === null || packs > 10000 || !Number.isSafeInteger(packs * cents) ||
      packs * cents > 100000000) {
    return { state: 'invalid' as const, packs: null, lineCents: null, unitPriceCents: null }
  }
  const unitPriceCents = exactManualUnitPriceCents(
    quote.packAmount, quote.packUnit as MatchUnit, count, cents,
  ) // Private display only: cents per kg, liter or piece, never basket cents.
  return {
    state: 'complete' as const,
    packs,
    lineCents: packs * cents,
    unitPriceCents: unitPriceCents !== null && Number.isSafeInteger(unitPriceCents) && unitPriceCents >= 0
      ? unitPriceCents : null,
  }
}

/** No mock catalogue, no price lookup. Totals only when BOTH stores cover the exact same needs. */
export function calculateManualComparison(
  needs: readonly ManualNeed[],
  entries: ManualEntries,
): ManualComparison {
  if (!Array.isArray(needs) || needs.length < 1 || needs.length > 100 ||
      !entries || typeof entries !== 'object' || Array.isArray(entries) ||
      new Set(needs.map(need => need.id)).size !== needs.length) {
    throw new Error('Geen bruikbare plannerbehoefte')
  }
  let missing = 0
  let invalid = 0
  let complete = 0
  const totals: Record<ManualRetailer, number> = { PLUS: 0, DekaMarkt: 0 }
  const rows: ManualLine[] = needs.map(need => {
    if (!need || typeof need.id !== 'string' || !need.id.trim() ||
        typeof need.label !== 'string' || !need.label.trim() ||
        !UNITS.has(need.unit)) throw new Error('Ongeldige plannerregel')
    const quotes = {} as ManualLine['quotes']
    for (const store of MANUAL_RETAILERS) {
      const value = evaluatedQuote(need, entries[manualQuoteKey(store, need.id)])
      ;(quotes as Record<ManualRetailer, typeof value>)[store] = value
      if (value.state === 'missing') missing++
      else if (value.state === 'invalid') invalid++
      else {
        complete++
        totals[store] += value.lineCents!
        if (!Number.isSafeInteger(totals[store]) || totals[store] > 100000000) {
          throw new Error('Mandbedrag is onbetrouwbaar')
        }
      }
    }
    return { ingredientId: need.id, label: need.label, requiredAmount: need.amount, requiredUnit: need.unit, quotes }
  })
  const fullBasket = missing === 0 && invalid === 0
  const deltaCents = fullBasket ? totals.PLUS - totals.DekaMarkt : null
  return {
    rows, missing, invalid, complete, fullBasket,
    totals: fullBasket ? totals : { PLUS: null, DekaMarkt: null },
    deltaCents,
    cheaper: deltaCents === null || deltaCents === 0 ? null
      : deltaCents > 0 ? 'DekaMarkt' : 'PLUS',
    source: 'own-unverified-entries',
    publicSavingsClaimEligible: false,
    productionEnabled: false,
  }
}
