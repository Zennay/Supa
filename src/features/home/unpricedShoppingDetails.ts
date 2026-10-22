/** Private counts and notes for the separate, intentionally unpriced Producten shortlist. */
export const unpricedShoppingDetailsKey = 'supa:unpriced-product-details:v1'
export type ShoppingPick = Readonly<{ id: string; count: number; note: string }>
export type ShoppingDetails = Readonly<{
  entries: readonly ShoppingPick[]
  raw: string | null
  writable: boolean
}>
const empty = (raw: string | null, writable: boolean): ShoppingDetails => ({ entries: [], raw, writable })
const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 100 &&
  !/[\p{Cc}\p{Cf}]/u.test(value)
const validNote = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 120 &&
  !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)
const validPick = (value: ShoppingPick) =>
  validId(value.id) && Number.isSafeInteger(value.count) &&
  value.count >= 1 && value.count <= 99 && validNote(value.note)

export function readUnpricedShoppingDetails(): ShoppingDetails {
  if (typeof window === 'undefined') return empty(null, false)
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(unpricedShoppingDetailsKey)
    if (raw === null) return empty(null, true)
    if (new TextEncoder().encode(raw).byteLength > 32000) return empty(raw, false)
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return empty(raw, false)
    const record = value as Record<string, unknown>
    if (Object.keys(record).sort().join('|') !== 'entries|schemaVersion' ||
        record.schemaVersion !== 1 || !Array.isArray(record.entries) ||
        record.entries.length > 100) return empty(raw, false)
    const entries: ShoppingPick[] = []
    const seen = new Set<string>()
    for (const item of record.entries) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return empty(raw, false)
      const entry = item as Record<string, unknown>
      if (Object.keys(entry).sort().join('|') !== 'count|id|note' ||
          !validPick(entry as unknown as ShoppingPick) || seen.has(entry.id as string))
        return empty(raw, false)
      seen.add(entry.id as string)
      entries.push({ id: entry.id as string, count: entry.count as number, note: entry.note as string })
    }
    return { entries, raw, writable: true }
  } catch {
    return empty(raw, false)
  }
}

/** Compare-and-set prevents this feature from overwriting unknown/newer storage. */
export function saveUnpricedShoppingDetails(
  previous: ShoppingDetails, entries: readonly ShoppingPick[],
): ShoppingDetails | null {
  if (typeof window === 'undefined' || !previous.writable || entries.length > 100 ||
      entries.some(entry => !validPick(entry)) ||
      new Set(entries.map(entry => entry.id)).size !== entries.length) return null
  try {
    if (window.localStorage.getItem(unpricedShoppingDetailsKey) !== previous.raw) return null
    const raw = JSON.stringify({ schemaVersion: 1, entries })
    if (new TextEncoder().encode(raw).byteLength > 32000) return null
    window.localStorage.setItem(unpricedShoppingDetailsKey, raw)
    return { entries: [...entries], raw, writable: true }
  } catch {
    return null
  }
}
