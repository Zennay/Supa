import plusCatalog from '../../../fixtures/m1/plus-rendered-catalog.v1.json'
import dekaMilk from '../../../fixtures/m1/dekamarkt-product-halfvolle-melk.v1.json'

/**
 * Historical source-capture identities for an INTERNAL UI review, not a
 * production retailer feed. The source-permission gate is NOT production-ready.
 * No prices, discounts, availability or saving claims may cross this boundary.
 * A genuine current catalog requires separate licensed data and publication
 * approval; do not promote this archive to that role.
 */
export type HistoricalRetailerProduct = {
  id: string
  name: string
  store: 'PLUS' | 'DekaMarkt'
  pack: string
  capturedAt: string
  sourceUrl: string
  price: null
  status: 'historical-source-only'
}

const validTime = (value: string) => /^\\d{4}-\\d{2}-\\d{2}T/.test(value) && Number.isFinite(Date.parse(value))
const plusOrigin = 'https://www.plus.nl'
const dekaOrigin = 'https://www.dekamarkt.nl'

function plusItem(card: typeof plusCatalog.cards[number]): HistoricalRetailerProduct | null {
  const name = card.name?.trim()
  const pack = card.packText?.trim()
  if (!name || !pack || !card.href?.startsWith('/product/') ||
      !/^\\/product\\/[a-z0-9-]+$/.test(card.href) ||
      !validTime(plusCatalog.source.capturedAt) ||
      plusCatalog.source.supermarket !== 'plus') return null
  return {
    id: `historical:plus:${card.href.slice('/product/'.length)}`,
    name, pack, store: 'PLUS',
    capturedAt: plusCatalog.source.capturedAt,
    sourceUrl: new URL(card.href, plusOrigin).href,
    price: null, status: 'historical-source-only',
  }
}

function dekaItem(): HistoricalRetailerProduct | null {
  const name = dekaMilk.jsonLdProduct?.name?.trim()
  const url = dekaMilk.source?.url
  const source = dekaMilk.source
  if (!name || !url || !url.startsWith(dekaOrigin + '/producten/') ||
      source.supermarket !== 'dekamarkt' || source.kind !== 'product' ||
      !validTime(source.capturedAt)) return null
  return {
    id: `historical:deka:${dekaMilk.nuxtPayload[5]}`,
    name, store: 'DekaMarkt', pack: '1 liter',
    capturedAt: source.capturedAt, sourceUrl: url,
    price: null, status: 'historical-source-only',
  }
}

export const historicalRetailerProducts: readonly HistoricalRetailerProduct[] = Object.freeze(
  [...plusCatalog.cards.map(plusItem), dekaItem()].filter(
    (item): item is HistoricalRetailerProduct => item !== null,
  ).map(item => Object.freeze(item)),
)

export function filterHistoricalProducts(
  products: readonly HistoricalRetailerProduct[],
  query: string,
  store: 'all' | 'PLUS' | 'DekaMarkt',
): HistoricalRetailerProduct[] {
  const cleanQuery = query.trim().toLocaleLowerCase('nl-NL')
  return products.filter(item => item.status === 'historical-source-only' &&
    item.price === null && (store === 'all' || item.store === store) &&
    item.name.toLocaleLowerCase('nl-NL').includes(cleanQuery))
}
