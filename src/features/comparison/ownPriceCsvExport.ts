import { parseOfflinePriceSnapshots } from '../../domain/offlineReviewedImport.ts'

type OwnProduct = {
  id: string
  name: string
  packAmount: number | null
  packUnit: string
  packCount?: number
  priceCents: number | null
  available: boolean
}
type OwnCapture = { retailer: 'PLUS' | 'DekaMarkt'; observedAt: string; products: OwnProduct[] }
const HEADER = [
  'retailer', 'observedAt', 'id', 'name', 'packAmount',
  'packUnit', 'packCount', 'priceCents', 'available',
] as const

/** Export only fully admitted *personal* captures in the existing CSV schema.
 * The imported values must survive the original strict browser converter
 * exactly, never silently sanitizing a real original SKU, name or price.
 */
export async function ownPriceCapturesToCsv(
  sourceJson: string, onlyStore?: 'PLUS' | 'DekaMarkt',
): Promise<string> {
  parseOfflinePriceSnapshots(sourceJson, Date.now())
  const root = JSON.parse(sourceJson) as { captures: OwnCapture[] }
  const captures = onlyStore
    ? root.captures.filter(capture => capture.retailer === onlyStore)
    : root.captures
  if (captures.length === 0) {
    throw new Error('Voor deze winkel bestaat geen complete eigen bronopname.')
  }
  const cell = (value: string) => '"' + value.replaceAll('"', '""') + '"'
  const rows = captures.flatMap(capture => capture.products.map(product => [
    capture.retailer, capture.observedAt, product.id, product.name,
    product.packAmount === null ? '' : String(product.packAmount),
    product.packUnit, String(product.packCount ?? 1),
    product.priceCents === null ? '' : String(product.priceCents),
    String(product.available),
  ]))
  const csv = [HEADER, ...rows].map(row => row.map(value => cell(String(value))).join(','))
    .join('\r\n') + '\r\n'
  if (new TextEncoder().encode(csv).length > 256000) {
    throw new Error('De herimporteerbare CSV is groter dan 256 kB.')
  }
  // Use the same strict browser importer as the file input, not a duplicate
  // validator with weaker security, schema, or observedAt rules.
  const url = '/offline-two-store-csv.mjs'
  const module: unknown = await import(/* @vite-ignore */ url)
  if (!module || typeof module !== 'object' ||
      !('convertOwnStoreCsv' in module) ||
      typeof module.convertOwnStoreCsv !== 'function') {
    throw new Error('De bestaande lokale CSV-converter is niet beschikbaar.')
  }
  const parsed = JSON.parse((module.convertOwnStoreCsv as (value: string) => string)(csv)) as {
    captures: OwnCapture[]
  }
  if (parsed.captures.length !== captures.length) {
    throw new Error('CSV kan de originele winkelopnames niet volledig behouden.')
  }
  for (const original of captures) {
    const restored = parsed.captures.find(item => item.retailer === original.retailer)
    if (!restored || restored.observedAt !== original.observedAt ||
        restored.products.length !== original.products.length ||
        original.products.some((p, index) => {
          const other = restored.products[index]
          return !other || p.id !== other.id || p.name !== other.name ||
            p.packAmount !== other.packAmount || p.packUnit !== other.packUnit ||
            (p.packCount ?? 1) !== (other.packCount ?? 1) || p.priceCents !== other.priceCents ||
            p.available !== other.available
        })) {
      throw new Error('CSV zou originele producten, verpakkingen of prijzen wijzigen. Gebruik JSON.')
    }
  }
  return '\uFEFF' + csv
}
