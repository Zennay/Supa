import { parseOfflinePriceSnapshots, type OfflineRetailer } from '../../domain/offlineReviewedImport.ts'

/**
 * Append genuinely new user-observed products to a single existing capture,
 * ONLY when the exact original observation instant is unchanged. A different
 * capture time must be treated as a new full source; never silently give old
 * prices a newer timestamp or new prices an older timestamp.
 */
export function appendPrivateCaptureProducts(
  previousJson: string, incomingJson: string, store: OfflineRetailer, now = Date.now(),
): { source: string; added: number; products: number } {
  const previous = parseOfflinePriceSnapshots(previousJson, now)
  const incoming = parseOfflinePriceSnapshots(incomingJson, now)
  const oldCapture = previous.captures[store]
  const nextCapture = incoming.captures[store]
  if (!oldCapture || !nextCapture || Object.keys(incoming.captures).length !== 1)
    throw new Error('Kies precies één aanvulling voor een reeds opgenomen winkel.')
  if (oldCapture.observedAt !== nextCapture.observedAt)
    throw new Error('De bronmomenten verschillen. Voeg geen nieuwe producten toe aan een oudere opname: maak voor deze winkel een volledige nieuwe prijsopname.')
  // A stale or future capture can be recorded as history, but not extended as
  // if it were an actionable current shopping source.
  const nowNs = BigInt(Math.trunc(now)) * 1_000_000n
  if (nowNs < oldCapture.observedNs - 300_000_000_000n ||
      nowNs - oldCapture.observedNs > 604_800_000_000_000n)
    throw new Error('Deze winkelopname is ouder dan zeven dagen of ligt in de toekomst. Maak een volledig nieuwe opname.')

  const ids = new Set(oldCapture.products.map(p => p.id))
  if (nextCapture.products.some(product => ids.has(product.id)))
    throw new Error('De aanvulling bevat een al bestaande broncode. Gebruik Vervang winkelopname om bestaande producten of prijzen te corrigeren.')
  const original = JSON.parse(previousJson) as { schema: string; captures: Array<{
    retailer: string; observedAt: string; products: unknown[]
  }> }
  const addition = JSON.parse(incomingJson) as { captures: Array<{
    retailer: string; observedAt: string; products: unknown[]
  }> }
  const base = original.captures.find(c => c.retailer === store)
  const added = addition.captures[0]
  if (!base || added.retailer !== store) throw new Error('De winkelcodes horen niet bij dezelfde bronopname.')
  const composed = {
    schema: original.captures.length === 1 ? 'supa-private-single-store-prices-v1' : 'supa-offline-prices-v1',
    captures: original.captures.map(capture => capture.retailer === store
      ? { ...capture, products: [...base.products, ...added.products] } : capture),
  }
  const source = JSON.stringify(composed)
  const verified = parseOfflinePriceSnapshots(source, now)
  const products = verified.captures[store]?.products.length
  if (products !== oldCapture.products.length + nextCapture.products.length)
    throw new Error('De samengevoegde bron mist oorspronkelijke of nieuwe producten.')
  return { source, added: nextCapture.products.length, products }
}
