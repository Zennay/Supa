import type { StoreProduct } from './basket.ts'
import type { MatchUnit } from './matching.ts'

/** Local user-supplied observations. This format is NOT proof of retailer permission or independent field verification. */
export type OfflineRetailer = 'PLUS' | 'DekaMarkt'
export type OfflineCapture = Readonly<{
  retailer: OfflineRetailer
  observedAt: string
  observedMs: number
  observedNs: bigint
  products: StoreProduct[]
}>
export type OfflinePriceSnapshots = Readonly<{
  captures: Readonly<Partial<Record<OfflineRetailer, OfflineCapture>>>
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
function observedInstant(raw: unknown): { ms: number; ns: bigint } | null {
  if (typeof raw !== 'string') return null
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,9}))?([+-])(\d\d):(\d\d)$/.exec(raw)
  if (!match) return null
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] =
    [match[1], match[2], match[3], match[4], match[5], match[6], match[9], match[10]].map(Number)
  if (year < 2000 || year > 2100 || offsetMinute > 59 ||
      (match[8] === '+' ? offsetHour > 14 || (offsetHour === 14 && offsetMinute > 0)
        : offsetHour > 12 || (offsetHour === 12 && offsetMinute > 0))) return null
  const civil = new Date(0)
  civil.setUTCFullYear(year, month - 1, day)
  civil.setUTCHours(hour, minute, second, 0)
  if (civil.getUTCFullYear() !== year || civil.getUTCMonth() !== month - 1 ||
      civil.getUTCDate() !== day || civil.getUTCHours() !== hour ||
      civil.getUTCMinutes() !== minute || civil.getUTCSeconds() !== second) return null
  const parsed = Date.parse(raw)
  if (!Number.isFinite(parsed)) return null
  const fraction = (match[7] ?? '').padEnd(9, '0')
  // Date.parse retains milliseconds but drops later digits. Rebuild the exact
  // physical UTC instant for boundaries such as 24 hours plus one nanosecond.
  const fractionalMillis = Number(fraction.slice(0, 3))
  return { ms: parsed, ns: BigInt(parsed - fractionalMillis) * 1_000_000n + BigInt(fraction) }
}
function parseProduct(raw: unknown, retailer: OfflineRetailer): StoreProduct {
  if (!isRecord(raw) || !allowedFields(raw, ['id', 'name', 'packAmount', 'packUnit', 'packCount', 'priceCents', 'available']) ||
      !validName(raw.id, 100) || !validName(raw.name, 160) ||
      (raw.packAmount !== null && (typeof raw.packAmount !== 'number' || !Number.isFinite(raw.packAmount) ||
        raw.packAmount <= 0 || raw.packAmount > 100000)) ||
      (raw.available && raw.packAmount === null) ||
      (raw.packUnit === 'piece' && raw.packAmount !== null &&
        !Number.isSafeInteger(raw.packAmount)) ||
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
      !Array.isArray(root.captures) || !(
        (root.schema === 'supa-offline-prices-v1' && root.captures.length === 2) ||
        (root.schema === 'supa-private-single-store-prices-v1' && root.captures.length === 1)
      )) {
    throw new Error('Gebruik één eigen winkelopname (supa-private-single-store-prices-v1) of twee (supa-offline-prices-v1).')
  }
  const captures: Partial<Record<OfflineRetailer, OfflineCapture>> = {}
  for (const raw of root.captures) {
    if (!isRecord(raw) || !allowedFields(raw, ['retailer', 'observedAt', 'products']) ||
        !RETAILERS.includes(raw.retailer as OfflineRetailer) ||
        hasOwn(captures, raw.retailer as string) || !Array.isArray(raw.products) ||
        raw.products.length < 1 || raw.products.length > 1000) {
      throw new Error('Elke winkel moet één opname met maximaal 1.000 producten hebben.')
    }
    const retailer = raw.retailer as OfflineRetailer
    const instant = observedInstant(raw.observedAt)
    if (instant === null || instant.ns > BigInt(Math.trunc(now + 300000)) * 1_000_000n) {
      throw new Error('Ongeldige of toekomstige waarnemingstijd; gebruik ISO 8601 met tijdzone.')
    }
    const products = raw.products.map(product => parseProduct(product, retailer))
    if (new Set(products.map(product => product.id)).size !== products.length) {
      throw new Error('Dubbele product-ID binnen dezelfde winkel.')
    }
    captures[retailer] = { retailer, observedAt: raw.observedAt as string, observedMs: instant.ms, observedNs: instant.ns, products }
  }
  const nowNs = BigInt(Math.trunc(now)) * 1_000_000n
  const observations = Object.values(captures)
  const instants = observations.map(item => item.observedNs)
  const newestNs = instants.reduce((a, b) => a > b ? a : b)
  const oldestNs = instants.reduce((a, b) => a < b ? a : b)
  const gapNs = newestNs - oldestNs
  const ageHours = Number(nowNs - newestNs) / 3_600_000_000_000
  const gapHours = Number(gapNs) / 3_600_000_000_000
  return {
    captures, ageHours, gapHours,
    currentEnough: nowNs >= newestNs - 300_000_000_000n &&
      nowNs - oldestNs <= 604_800_000_000_000n,
    // A single source is never evidence of a second retailer or a price winner.
    pairedWithin24h: observations.length === 2 && gapNs <= 86_400_000_000_000n,
  }
}
