import { calculateDecimalPackCount } from './decimalPackArithmetic.ts'
import type { MatchUnit } from './matching.ts'

export type ManualNeed = Readonly<{ id: string; label: string; amount: number | null; unit: MatchUnit }>
export type ManualRetailer = 'PLUS' | 'DekaMarkt'
export type ManualQuote = Readonly<{
  product: string
  packAmount: string
  packUnit: MatchUnit
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

function evaluatedQuote(need: ManualNeed, quote: ManualQuote | undefined) {
  const empty = { state: 'missing' as const, packs: null, lineCents: null, unitPriceCents: null }
  if (!quote || !quote.product.trim() && !quote.packAmount.trim() && !quote.price.trim()) return empty
  const amount = amountValue(quote.packAmount)
  const cents = manualPriceCents(quote.price)
  const name = quote.product.trim()
  if (need.amount === null || !Number.isFinite(need.amount) || need.amount <= 0 ||
      name.length < 2 || name.length > 160 || /[\u0000-\u001f\u007f]/u.test(name) ||
      !unitsFor(need.unit).includes(quote.packUnit) || amount === null || cents === null) {
    return { state: 'invalid' as const, packs: null, lineCents: null, unitPriceCents: null }
  }
  const packs = calculateDecimalPackCount(
    [{ amount: need.amount, unit: need.unit }],
    { amount, unit: quote.packUnit, count: 1 },
  )
  if (packs === null || packs > 10000 || !Number.isSafeInteger(packs * cents) ||
      packs * cents > 100000000) {
    return { state: 'invalid' as const, packs: null, lineCents: null, unitPriceCents: null }
  }
  const baseAmount = (quote.packUnit === 'kg' || quote.packUnit === 'l') ? amount * 1000 : amount
  const unitPriceCents = baseAmount > 0 && quote.packUnit !== 'piece'
    ? Math.round(1000 * cents / baseAmount)
    : null // EUR per kg or liter, in cents, for this one entered pack.
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

/**
 * A real, shop-ready per-retailer checklist from THIS user's manual quotes.
 * One store may be complete even if the comparison against the other is not.
 * Never reuse demo fixture prices, silent zeroes or unverified retailer claims.
 */
export function prepareManualStoreShoppingCopy(
  needs: readonly ManualNeed[],
  entries: ManualEntries,
  retailer: ManualRetailer,
): Readonly<{ retailer: ManualRetailer; lineCount: number; totalCents: number; text: string;
  verifiedRetailerObservations: false; publicSavingsClaimEligible: false }> | null {
  if (!MANUAL_RETAILERS.includes(retailer)) return null
  const comparison = calculateManualComparison(needs, entries)
  if (!comparison.rows.length ||
      comparison.rows.some(row => row.quotes[retailer].state !== 'complete')) return null
  const formatter = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
  let totalCents = 0
  const lines: string[] = []
  for (const row of comparison.rows) {
    const quote = entries[manualQuoteKey(retailer, row.ingredientId)]
    const evaluated = row.quotes[retailer]
    if (!quote || evaluated.packs === null || evaluated.lineCents === null ||
        typeof quote.product !== 'string' || quote.product.trim().length < 2 ||
        /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(quote.product)) return null
    const amount = quote.packAmount.replace('.', ',')
    const packLabel = quote.packUnit === 'piece' ? 'stuks' : quote.packUnit
    lines.push(`${evaluated.packs} × ${quote.product.trim()} (${amount} ${packLabel} per verpakking) — ${formatter.format(evaluated.lineCents / 100)}`)
    totalCents += evaluated.lineCents
    if (!Number.isSafeInteger(totalCents) || totalCents > 100000000) return null
  }
  const text = [
    `SUPA · eigen boodschappenlijst voor ${retailer}`,
    'Gebaseerd op mijn eigen ingevoerde producten en prijzen. Niet geverifieerd door de supermarkt.',
    'Controleer product, verpakking, hoeveelheid en werkelijke prijs in de winkel.',
    '',
    ...lines,
    '',
    `Totaal volgens eigen invoer: ${formatter.format(totalCents / 100)}`,
    'Geen live winkelprijs, gegarandeerde beschikbaarheid of bewezen besparing.',
  ].join('\n')
  return Object.freeze({
    retailer,
    lineCount: lines.length,
    totalCents,
    text,
    verifiedRetailerObservations: false,
    publicSavingsClaimEligible: false,
  })
}
