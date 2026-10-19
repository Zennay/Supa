import { parseOfflinePriceSnapshots, type OfflineStoreProduct } from '../../domain/offlineReviewedImport.ts'
import { literalCsv } from '../../privateBasketComparisonCsv.ts'

const shops = ['PLUS', 'DekaMarkt'] as const
const maxBytes = 512_000

function cells(values: readonly unknown[]) {
  return values.map(value => literalCsv(value)).join(';')
}
function money(item: OfflineStoreProduct | undefined): number | string {
  return item && item.sourcePriceCents !== null && item.sourcePriceCents !== undefined
    ? item.sourcePriceCents : 'Onbekend'
}
function pack(item: OfflineStoreProduct | undefined) {
  return item && item.packAmount !== null
    ? String(item.packCount) + ' × ' + item.packAmount + ' ' + item.packUnit
    : 'Onbekend'
}
function availability(item: OfflineStoreProduct | undefined) {
  return item ? item.sourceAvailable === true ? 'Ja' : 'Nee / onbekend' : 'Niet aanwezig'
}

/** Export only genuine, locally imported, original SKU facts. A changed
 * capture is never proof of a retailer price or an independent observation. */
export function twoStoreReplacementCsv(
  previousText: string, incomingText: string, nowMs: number,
): string {
  const previous = parseOfflinePriceSnapshots(previousText, nowMs)
  const incoming = parseOfflinePriceSnapshots(incomingText, nowMs)
  if (!incoming.captures.PLUS || !incoming.captures.DekaMarkt) {
    throw new Error('Beide originele winkelbestanden zijn vereist.')
  }
  const rows: string[] = [
    cells(['Winkel', 'SKU', 'Wijziging', 'Oud bronmoment', 'Nieuw bronmoment',
      'Oude naam', 'Nieuwe naam', 'Oude verpakking', 'Nieuwe verpakking',
      'Oude pakprijs cent', 'Nieuwe pakprijs cent', 'Oude beschikbaarheid',
      'Nieuwe beschikbaarheid', 'Prijsverschil cent (zelfde SKU, pak alleen indien gelijk)']),
  ]
  for (const store of shops) {
    const old = previous.captures[store]
    const next = incoming.captures[store]!
    const original = new Map(old?.products.map(item => [item.id, item]))
    const replacement = new Map(next.products.map(item => [item.id, item]))
    const ids = new Set([...original.keys(), ...replacement.keys()])
    for (const id of ids) {
      const was = original.get(id)
      const after = replacement.get(id)
      const samePack = was && after &&
        was.packAmount === after.packAmount && was.packUnit === after.packUnit &&
        was.packCount === after.packCount
      const unchanged = was && after &&
        was.name === after.name && samePack &&
        was.sourcePriceCents === after.sourcePriceCents &&
        was.sourceAvailable === after.sourceAvailable
      const kind = !was ? 'Nieuw' : !after ? 'Verdwenen' : unchanged ? 'Ongewijzigd' : 'Gewijzigd'
      const priceDelta = samePack && was && after &&
        was.sourcePriceCents !== null && was.sourcePriceCents !== undefined &&
        after.sourcePriceCents !== null && after.sourcePriceCents !== undefined &&
        was.sourceAvailable === true && after.sourceAvailable === true
        ? after.sourcePriceCents - was.sourcePriceCents : 'Onbekend'
      rows.push(cells([store, id, kind, old?.observedAt ?? 'Onbekend',
        next.observedAt, was?.name ?? '', after?.name ?? '',
        pack(was), pack(after), money(was), money(after),
        availability(was), availability(after), priceDelta]))
    }
  }
  const output = '\uFEFF' + rows.join('\r\n') + '\r\n'
  if (new TextEncoder().encode(output).length > maxBytes) {
    throw new Error('Dit wijzigingenoverzicht is groter dan 512 kB.')
  }
  return output
}
