/**
 * Contract between the frontend and the scraper backend.
 * See docs/BACKEND_CONTRACT.md. The frontend only depends on this shape, so
 * the scrapers can change freely as long as the API returns it.
 */
export type ApiProduct = {
  id: string
  name: string
  /** Supermarket id: jumbo, dirk, ah, lidl, plus, vomar, aldi, hoogvliet. */
  store: string
  /** Pack size as shown to people, for example "1.5L" or "500 gram". */
  unit: string
  /** Price per kg or litre, for example "€1.16/L". Optional. */
  unitPrice?: string
  /** Current price in euro cents. */
  priceCents: number
  /** Price before discount in euro cents. Optional. */
  oldPriceCents?: number
  /** Absolute https URL of the product photo. Optional. */
  imageUrl?: string
  /** When the price was observed, ISO 8601. */
  observedAt: string
}

const storeIds = ['jumbo', 'dirk', 'ah', 'lidl', 'plus', 'vomar', 'aldi', 'hoogvliet']

const isCents = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < 10_000_000

/** Accepts only well-formed products; anything else is dropped, never guessed. */
export function parseApiProducts(payload: unknown): ApiProduct[] {
  const list = payload && typeof payload === 'object' && Array.isArray((payload as { products?: unknown }).products)
    ? (payload as { products: unknown[] }).products : []
  const result: ApiProduct[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const { id, name, store, unit, unitPrice, priceCents, oldPriceCents, imageUrl, observedAt } = record
    if (typeof id !== 'string' || !/^[\w:.-]{1,80}$/.test(id)) continue
    if (typeof name !== 'string' || !name.trim() || name.length > 160) continue
    if (typeof store !== 'string' || !storeIds.includes(store)) continue
    if (typeof unit !== 'string' || unit.length > 40) continue
    if (!isCents(priceCents)) continue
    if (typeof observedAt !== 'string' || Number.isNaN(Date.parse(observedAt))) continue
    result.push({
      id, name: name.trim(), store, unit,
      unitPrice: typeof unitPrice === 'string' && unitPrice.length <= 30 ? unitPrice : undefined,
      priceCents,
      oldPriceCents: isCents(oldPriceCents) && oldPriceCents > priceCents ? oldPriceCents : undefined,
      imageUrl: typeof imageUrl === 'string' && /^https:\/\//.test(imageUrl) ? imageUrl : undefined,
      observedAt,
    })
  }
  return result
}

export async function fetchApiProducts(baseUrl: string, signal?: AbortSignal): Promise<ApiProduct[]> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/products`, {
    signal, headers: { accept: 'application/json' }, credentials: 'omit',
  })
  if (!response.ok) throw new Error(`Product API antwoordde met ${response.status}`)
  return parseApiProducts(await response.json())
}
