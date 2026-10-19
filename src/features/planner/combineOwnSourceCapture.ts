import {
  parseOfflinePriceSnapshots,
  type OfflineRetailer,
} from '../../domain/offlineReviewedImport.ts'

const shops = ['PLUS', 'DekaMarkt'] as const
const maxBytes = 256_000

type RawCapture = { retailer: OfflineRetailer; [key: string]: unknown }
type RawSource = { captures: RawCapture[] }

export type CaptureRefreshChanges = Readonly<{
  addedSkus: number
  removedSkus: number
  priceChangedSkus: number
  packageChangedSkus: number
  becameUnpricedSkus: number
  availabilityChangedSkus: number
  previousObservedAt: string | null
  newObservedAt: string
  affectedTotal: number
  affectedProducts: readonly Readonly<{ sku: string; name: string; change: string }>[]
}>

function refreshChanges(
  old: NonNullable<ReturnType<typeof parseOfflinePriceSnapshots>['captures'][OfflineRetailer]> | undefined,
  updated: NonNullable<ReturnType<typeof parseOfflinePriceSnapshots>['captures'][OfflineRetailer]>,
): CaptureRefreshChanges {
  const before = new Map(old?.products.map(product => [product.id, product]) ?? [])
  const after = new Map(updated.products.map(product => [product.id, product]))
  let addedSkus = 0
  let priceChangedSkus = 0
  let packageChangedSkus = 0
  let becameUnpricedSkus = 0
  let availabilityChangedSkus = 0
  const affected: { sku: string; name: string; change: string; priority: number }[] = []
  for (const [id, current] of after) {
    const previous = before.get(id)
    if (!previous) {
      addedSkus++
      affected.push({ sku: id, name: current.name, change: 'Nieuwe originele SKU', priority: 4 })
      continue
    }
    const priceChanged = previous.sourcePriceCents !== null &&
      current.sourcePriceCents !== null &&
      previous.sourcePriceCents !== current.sourcePriceCents
    const packChanged = previous.packAmount !== current.packAmount ||
      previous.packUnit !== current.packUnit || previous.packCount !== current.packCount
    const becameUnpriced = previous.sourcePriceCents !== null &&
      current.sourcePriceCents === null
    const availableChanged = previous.sourceAvailable !== current.sourceAvailable
    if (priceChanged) priceChangedSkus++
    if (packChanged) packageChangedSkus++
    if (becameUnpriced) becameUnpricedSkus++
    if (availableChanged) availabilityChangedSkus++
    const labels = [
      becameUnpriced && 'Pakprijs ontbreekt nu',
      availableChanged && 'Beschikbaarheid gewijzigd',
      packChanged && 'Verpakking gewijzigd',
      priceChanged && 'Opgenomen pakprijs gewijzigd',
    ].filter((label): label is string => !!label)
    if (labels.length) affected.push({
      sku: id, name: current.name, change: labels.join(' · '),
      priority: becameUnpriced ? 1 : availableChanged ? 2 : packChanged ? 3 : 4,
    })
  }
  for (const [id, previous] of before) {
    if (!after.has(id)) affected.push({
      sku: id, name: previous.name, change: 'Verdwenen uit nieuwe winkelbron',
      priority: 0,
    })
  }
  affected.sort((a, b) => a.priority - b.priority || a.sku.localeCompare(b.sku, 'nl'))
  return {
    addedSkus,
    removedSkus: [...before.keys()].filter(id => !after.has(id)).length,
    priceChangedSkus,
    packageChangedSkus,
    becameUnpricedSkus,
    availabilityChangedSkus,
    previousObservedAt: old?.observedAt ?? null,
    newObservedAt: updated.observedAt,
    affectedTotal: affected.length,
    affectedProducts: affected.slice(0, 15).map(({ sku, name, change }) => ({
      sku, name, change,
    })),
  }
}

/**
 * Keep each *original* retailer capture intact when a person supplies an
 * explicitly newer single-retailer source. Never stitch price rows from two
 * timestamps inside one retailer; that would manufacture an observation.
 * The canonical parser rechecks originals and the resulting combined source.
 */
export function replaceOwnStoreCapture(
  originalText: string,
  incomingSingleStoreText: string,
  nowMs: number,
): {
  normalized: string
  retailer: OfflineRetailer
  action: 'added' | 'replaced'
  pairedWithin24h: boolean
  changes: CaptureRefreshChanges
} {
  const original = parseOfflinePriceSnapshots(originalText, nowMs)
  const incoming = parseOfflinePriceSnapshots(incomingSingleStoreText, nowMs)
  const found = shops.filter(shop => !!incoming.captures[shop])
  if (found.length !== 1) {
    throw new Error('De nieuwe bron moet precies één PLUS- of DekaMarkt-opname bevatten.')
  }

  const retailer = found[0]
  const updated = incoming.captures[retailer]!
  const old = original.captures[retailer]
  if (old && updated.observedNs <= old.observedNs) {
    throw new Error(retailer + ': de nieuwe bron is niet later dan de bestaande opname. Er is niets vervangen.')
  }
  const oldRoot = JSON.parse(originalText) as RawSource
  const newRoot = JSON.parse(incomingSingleStoreText) as RawSource
  const captures = shops.flatMap(shop => {
    if (shop === retailer) return [newRoot.captures[0]]
    return oldRoot.captures.filter(capture => capture.retailer === shop)
  })
  const normalized = JSON.stringify({
    schema: captures.length === 2 ? 'supa-offline-prices-v1' : 'supa-private-single-store-prices-v1',
    captures,
  })
  if (new TextEncoder().encode(normalized).byteLength > maxBytes) {
    throw new Error('Gecombineerde bron is groter dan 256 kB. Maak een kleinere originele winkelopname.')
  }
  const result = parseOfflinePriceSnapshots(normalized, nowMs)
  return {
    normalized,
    retailer,
    action: old ? 'replaced' : 'added',
    pairedWithin24h: result.pairedWithin24h,
    changes: refreshChanges(old, updated),
  }
}
