import { productFieldsMatchTerms, productSearchTerms } from './productSearchText.ts'

/**
 * Deliberately PRICE-FREE identity projection of archived M1 captures.
 *
 * The M1 JSON fixtures contain observed historical prices; never import those
 * JSON files into a browser bundle. This approved-for-UI-review projection
 * contains only name, pack, origin URL and capture time. It is NOT a licensed
 * retailer catalog, nor real-time stock/price data. Public publication is
 * blocked by the separate source-permission gate until rights are cleared.
 */
export type HistoricalRetailerProduct = Readonly<{
  id: string
  name: string
  store: 'PLUS' | 'DekaMarkt'
  pack: string
  capturedAt: string
  sourceUrl: string
  price: null
  status: 'historical-source-only'
}>

const observedPlus = '2026-10-04T18:53:02.645Z'
const observedDeka = '2026-10-04T18:15:29.695Z'

// Identities and packaging transcribed only from reviewed repository evidence:
// fixtures/m1/plus-rendered-catalog.v1.json (4 cards)
// fixtures/m1/dekamarkt-product-halfvolle-melk.v1.json (1 product).
// Every field is checked for drift by test, without bundling prices into React.
const identities: HistoricalRetailerProduct[] = [
  { id: 'historical:plus:113651', name: 'PLUS Bananen Fairtrade', store: 'PLUS', pack: 'Per 1000 gram', capturedAt: observedPlus, sourceUrl: 'https://www.plus.nl/product/plus-bananen-fairtrade-kg-1000-g-113651', price: null, status: 'historical-source-only' },
  { id: 'historical:plus:579010', name: 'Zuivelmeester Halfvolle melk', store: 'PLUS', pack: 'Per 1000 ml', capturedAt: observedPlus, sourceUrl: 'https://www.plus.nl/product/zuivelmeester-halfvolle-melk-pak-1000-ml-579010', price: null, status: 'historical-source-only' },
  { id: 'historical:plus:145701', name: 'Zuivelmeester Halfvolle melk', store: 'PLUS', pack: 'Per 2000 ml', capturedAt: observedPlus, sourceUrl: 'https://www.plus.nl/product/zuivelmeester-halfvolle-melk-can-2000-ml-145701', price: null, status: 'historical-source-only' },
  { id: 'historical:plus:579021', name: 'Zuivelmeester Karnemelk', store: 'PLUS', pack: 'Per 1000 ml', capturedAt: observedPlus, sourceUrl: 'https://www.plus.nl/product/zuivelmeester-karnemelk-pak-1000-ml-579021', price: null, status: 'historical-source-only' },
  { id: 'historical:dekamarkt:115873', name: 'Zuivelmeester Halfvolle melk', store: 'DekaMarkt', pack: '1 liter', capturedAt: observedDeka, sourceUrl: 'https://www.dekamarkt.nl/producten/zuivel-kaas/melk-karnemelk/zuivelmeester-halfvolle-melk-1-liter/115873', price: null, status: 'historical-source-only' },
]

export const historicalRetailerProducts: readonly HistoricalRetailerProduct[] =
  Object.freeze(identities.map(item => Object.freeze(item)))

export type HistoricalPackKind = 'mass' | 'volume' | 'other'
export type HistoricalPackFilter = 'all' | HistoricalPackKind

type ParsedHistoricalPack = { kind: HistoricalPackKind; label: string } | null

/** Parse only an explicit amount/unit from the source label; never infer SKU or price. */
function parseHistoricalPack(pack: string): ParsedHistoricalPack {
  const match = /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(kilogram|kg|gram|g|milliliter|millilitre|ml|liter|litre|l)\b/iu.exec(pack)
  if (!match) return null
  const amount = Number(match[1].replace(',', '.'))
  if (!Number.isFinite(amount) || amount <= 0) return null
  const unit = match[2].toLocaleLowerCase('nl-NL')
  if (['kilogram', 'kg', 'gram', 'g'].includes(unit)) {
    const kg = ['gram', 'g'].includes(unit) ? amount / 1000 : amount
    return { kind: 'mass', label: (kg >= 1 ? kg : kg * 1000).toLocaleString('nl-NL', { maximumFractionDigits: 3 }) + (kg >= 1 ? ' kg' : ' g') }
  }
  const liters = ['milliliter', 'millilitre', 'ml'].includes(unit) ? amount / 1000 : amount
  return { kind: 'volume', label: (liters >= 1 ? liters : liters * 1000).toLocaleString('nl-NL', { maximumFractionDigits: 3 }) + (liters >= 1 ? ' l' : ' ml') }
}

export function historicalPackageEquivalent(pack: string): string | null {
  return parseHistoricalPack(pack)?.label ?? null
}

export function filterHistoricalProducts(
  products: readonly HistoricalRetailerProduct[],
  query: string,
  store: 'all' | 'PLUS' | 'DekaMarkt',
  packFilter: HistoricalPackFilter = 'all',
): HistoricalRetailerProduct[] {
  const terms = productSearchTerms(query)
  return products.filter(item => {
    if (item.status !== 'historical-source-only' || item.price !== null ||
        (store !== 'all' && item.store !== store)) return false
    const pack = parseHistoricalPack(item.pack)
    if (packFilter !== 'all' && (pack?.kind ?? 'other') !== packFilter) return false
    return productFieldsMatchTerms([item.name, item.pack, item.store, item.capturedAt, item.sourceUrl, item.id], terms)
  })
}
