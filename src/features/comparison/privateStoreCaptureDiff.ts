import { parseOfflinePriceSnapshots, type OfflineRetailer } from '../../domain/offlineReviewedImport.ts'
import { replacePrivateStoreCapture } from './replacePrivateStoreCapture.ts'

type SourceProduct = {
  id: string; name: string; packAmount: number | null; packUnit: string
  packCount?: number; priceCents: number | null; available: boolean
}
type SourceCapture = { retailer: OfflineRetailer; observedAt: string; products: SourceProduct[] }

/**
 * A preview of changes in genuine user-provided source bytes. Original null
 * prices stay null even though the basket matcher internally represents
 * unknown as unavailable. This is NOT retailer or field observation proof.
 */
export function describePrivateStoreCaptureChange(
  existingText: string, incomingText: string, store: OfflineRetailer, now: number,
) {
  // Canonical admission first: don't try to infer a retailer from a filename.
  const existing = parseOfflinePriceSnapshots(existingText, now)
  const next = parseOfflinePriceSnapshots(incomingText, now)
  if (!existing.captures[store] || !next.captures[store] ||
      Object.keys(next.captures).length !== 1) {
    throw new Error('Selecteer precies één nieuwe originele opname voor dezelfde winkel.')
  }
  const merged = replacePrivateStoreCapture(existingText, incomingText, store, now)
  const oldCapture = (JSON.parse(existingText) as { captures: SourceCapture[] })
    .captures.find(item => item.retailer === store)!
  const newCapture = (JSON.parse(incomingText) as { captures: SourceCapture[] })
    .captures[0]
  const original = new Map(oldCapture.products.map(item => [item.id, item]))
  const replacement = new Map(newCapture.products.map(item => [item.id, item]))
  const added = newCapture.products.filter(item => !original.has(item.id)).length
  const removed = oldCapture.products.filter(item => !replacement.has(item.id)).length
  const changed = newCapture.products.filter(item => {
    const prior = original.get(item.id)
    return prior !== undefined && (
      prior.name !== item.name ||
      prior.packAmount !== item.packAmount ||
      prior.packUnit !== item.packUnit ||
      (prior.packCount ?? 1) !== (item.packCount ?? 1) ||
      prior.available !== item.available ||
      prior.priceCents !== item.priceCents
    )
  }).length
  const formatCents = (item: SourceProduct): string => {
    if (!item.available || item.priceCents === null) return 'prijs onbekend / niet beschikbaar'
    return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
      .format(item.priceCents / 100) + ' per pak'
  }
  const priceExamples = newCapture.products.flatMap(item => {
    const previous = original.get(item.id)
    return previous && (previous.priceCents !== item.priceCents ||
      previous.available !== item.available)
      ? [{ name: item.name, sourceId: item.id,
        before: formatCents(previous), after: formatCents(item) }]
      : []
  }).slice(0, 8)
  return {
    store,
    previousObservedAt: oldCapture.observedAt,
    nextObservedAt: newCapture.observedAt,
    previousCount: oldCapture.products.length,
    nextCount: newCapture.products.length,
    added, removed, changed, priceExamples,
    otherStore: store === 'PLUS' ? 'DekaMarkt' : 'PLUS',
    pairedWithin24h: merged.captured.pairedWithin24h,
    currentEnough: merged.captured.currentEnough,
  }
}
