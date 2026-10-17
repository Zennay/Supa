import type { StoreProduct } from './basket.ts'
import type { MatchUnit } from './matching.ts'

/** Local user-supplied observations. This format is NOT proof of retailer permission or independent field verification. */
export type OfflineRetailer = 'PLUS' | 'DekaMarkt'
export type OfflineCapture = Readonly<{
  retailer: OfflineRetailer
  observedAt: string
  observedMs: number
  products: StoreProduct[]
}>
export type OfflinePriceSnapshots = Readonly<{
  captures: Readonly<Record<OfflineRetailer, OfflineCapture>>
  ageHours: number
  gapHours: number
  currentEnough: boolean
  pairedWithin24h: boolean
}>
const RETAILERS = ['PLUS', 'DekaMarkt'] as const
const UNITS: ReadonlySet<string> = new Set(['g', 'kg', 'ml', 'l', 'piece'])
// A missing package is represented by null rather than a fabricated size. Only
// a positive measured package and known price may become a purchasable match.
const hasOwn = (x: object, key: string) => Object.hasOwn(x, key)
const isRecord = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x)
const allowedFields = (x: Record<string, unknown>, fields: string[]) =>
  Object.keys(x).every(key => fields.includes(key))
function validName(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value === value.trim() && /[\p{L}\p{N}]/u.test(value) &&
    !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)
}
/** Only real Gregorian civil dates and explicit timezone offsets are accepted. */
function observedMilliseconds(raw: unknown): number | null {
  if (typeof raw !== 'string') return null
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,9})?([+-])(\d\d):(\d\d)$/.exec(raw)
  if (!match) return null
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] =
    [match[1], match[2], match[3], match[4], match[5], match[6], match[8], match[9]].map(Number)
  if (year < 2000 || year > 2100 || offsetMinute > 59 ||
      (match[7] === '+' ? offsetHour > 14 || (offsetHour === 14 && offsetMinute > 0)
        : offsetHour > 12 || (offsetHour === 12 && offsetMinute > 0))) return null
  const civil = new Date(0)
  civil.setUTCFullYear(year, month - 1, day)
  civil.setUTCHours(hour, minute, second, 0)
  if (civil.getUTCFullYear() !== year || civil.getUTCMonth() !== month - 1 ||
      civil.getUTCDate() !== day || civil.getUTCHours() !== hour ||
      civil.getUTCMinutes() !== minute || civil.getUTCSeconds() !== second) return null
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : null
}
function parseProduct(raw: unknown, retailer: OfflineRetailer): StoreProduct {
  if (!isRecord(raw) || !allowedFields(raw, ['id', 'name', 'packAmount', 'packUnit', 'packCount', 'priceCents', 'available']) ||
      !validName(raw.id, 100) || !validName(raw.name, 160) ||
      (raw.packAmount !== null && (typeof raw.packAmount !== 'number' || !Number.isFinite(raw.packAmount) ||
        raw.packAmount <= 0 || raw.packAmount > 100000)) ||
      (raw.available && raw.packAmount === null) ||
      !UNITS.has(raw.packUnit as string) ||
      (raw.packCount !== undefined && (!Number.isSafeInteger(raw.packCount) ||
        (raw.packCount as number) < 1 || (raw.packCount as number) > 1000)) ||
      typeof raw.available !== 'boolean' ||
      (raw.priceCents !== null && (!Number.isSafeInteger(raw.priceCents) ||
        (raw.priceCents as number) < 0 || (raw.priceCents as number) > 1000000)) ||
      (raw.available && raw.priceCents === null) ||
      !hasOwn(raw, 'priceCents')) {
    throw new Error('Productrecord ongeldig: controleer ID, verpakking, voorraad en prijs in centen.')
  }
  return {
    id: raw.id, name: raw.name, storeId: retailer,
    packAmount: raw.packAmount,
    packUnit: raw.packUnit as MatchUnit,
    packCount: (raw.packCount as number | undefined) ?? 1,
    // Missing price is always unavailable; never promote it to a zero-price match.
    available: raw.available && raw.priceCents !== null,
    priceCents: (raw.priceCents as number | null) ?? 0,
  }
}
export function parseOfflinePriceSnapshots(
  text: string, now: number,
): OfflinePriceSnapshots {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 256000 ||
      !Number.isFinite(now)) throw new Error('Bestand ontbreekt of is groter dan 256 kB.')
  let root: unknown
  try { root = JSON.parse(text) }
  catch { throw new Error('Importeer geldige UTF-8 JSON, geen HTML of CSV.') }
  if (!isRecord(root) || !allowedFields(root, ['schema', 'captures']) ||
      root.schema !== 'supa-offline-prices-v1' || !Array.isArray(root.captures) ||
      root.captures.length !== 2) {
    throw new Error('Verwacht schema supa-offline-prices-v1 met precies twee winkelopnames.')
  }
  const captures = {} as Record<OfflineRetailer, OfflineCapture>
  for (const raw of root.captures) {
    if (!isRecord(raw) || !allowedFields(raw, ['retailer', 'observedAt', 'products']) ||
        !RETAILERS.includes(raw.retailer as OfflineRetailer) ||
        hasOwn(captures, raw.retailer as string) || !Array.isArray(raw.products) ||
        raw.products.length < 1 || raw.products.length > 1000) {
      throw new Error('Elke winkel moet één opname met maximaal 1.000 producten hebben.')
    }
    const retailer = raw.retailer as OfflineRetailer
    const observedMs = observedMilliseconds(raw.observedAt)
    if (observedMs === null || observedMs > now + 300000) {
      throw new Error('Ongeldige of toekomstige waarnemingstijd; gebruik ISO 8601 met tijdzone.')
    }
    const products = raw.products.map(product => parseProduct(product, retailer))
    if (new Set(products.map(product => product.id)).size !== products.length) {
      throw new Error('Dubbele product-ID binnen dezelfde winkel.')
    }
    captures[retailer] = { retailer, observedAt: raw.observedAt as string, observedMs, products }
  }
  const ageHours = (now - Math.max(captures.PLUS.observedMs, captures.DekaMarkt.observedMs)) / 3600000
  const gapHours = Math.abs(captures.PLUS.observedMs - captures.DekaMarkt.observedMs) / 3600000
  return {
    captures, ageHours, gapHours,
    // Deliberately an indicative local comparison, never published retailer evidence.
    currentEnough: ageHours >= -5 / 60 && ageHours <= 168 &&
      now - Math.min(captures.PLUS.observedMs, captures.DekaMarkt.observedMs) <= 168 * 3600000,
    pairedWithin24h: gapHours <= 24,
  }
}
