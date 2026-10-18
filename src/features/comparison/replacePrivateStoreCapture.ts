import { parseOfflinePriceSnapshots, type OfflineRetailer } from '../../domain/offlineReviewedImport.ts'

/**
 * Replaces exactly ONE user's own original capture while preserving the
 * unaffected shop's original observations (including unknown price nulls).
 * Both source formats are admitted through the existing canonical parser.
 * No price, approval, timestamp or missing shop is manufactured here.
 */
export function replacePrivateStoreCapture(
  originalText: string, replacementText: string,
  retailer: OfflineRetailer, now: number,
): { source: string; captured: ReturnType<typeof parseOfflinePriceSnapshots> } {
  const existing = parseOfflinePriceSnapshots(originalText, now)
  if (!existing.captures[retailer]) {
    throw new Error('Deze winkel heeft nog geen bronopname om te vervangen.')
  }
  const incoming = parseOfflinePriceSnapshots(replacementText, now)
  if (Object.keys(incoming.captures).length !== 1 || !incoming.captures[retailer]) {
    throw new Error('Kies precies één nieuwe opname van dezelfde winkel; de andere winkel blijft bewaard.')
  }
  const oldRoot = JSON.parse(originalText) as { captures: unknown[] }
  const newRoot = JSON.parse(replacementText) as { captures: unknown[] }
  const others = oldRoot.captures.filter(capture =>
    (capture as { retailer: string }).retailer !== retailer)
  const source = JSON.stringify({
    schema: others.length ? 'supa-offline-prices-v1' : 'supa-private-single-store-prices-v1',
    captures: [...others, newRoot.captures[0]],
  })
  const captured = parseOfflinePriceSnapshots(source, now)
  return { source, captured }
}
