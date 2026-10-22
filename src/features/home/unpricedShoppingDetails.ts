/** Private shopping details for separately selected unpriced items. */
export const unpricedShoppingDetailsKey = 'supa:unpriced-product-details:v1'
export type ShoppingPick = Readonly<{ id: string; count: number; note: string }>
export type ShoppingDetails = Readonly<{ entries: readonly ShoppingPick[]; raw: string | null; writable: boolean }>
const empty = (raw: string | null, writable: boolean): ShoppingDetails => ({ entries: [], raw, writable })
const validId = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 100 && !/[\p{Cc}\p{Cf}]/u.test(v)
const validNote = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 120 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(v)
const valid = (p: ShoppingPick) =>
  validId(p.id) && Number.isSafeInteger(p.count) && p.count >= 1 && p.count <= 99 && validNote(p.note)
export function readUnpricedShoppingDetails(): ShoppingDetails {
  if (typeof window === 'undefined') return empty(null, false)
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(unpricedShoppingDetailsKey)
    if (raw === null) return empty(null, true)
    if (raw.length > 32000) return empty(raw, false)
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty(raw, false)
    const r = parsed as Record<string, unknown>
    if (Object.keys(r).sort().join('|') !== 'entries|schemaVersion' ||
      r.schemaVersion !== 1 || !Array.isArray(r.entries) || r.entries.length > 100)
      return empty(raw, false)
    const entries: ShoppingPick[] = []
    const ids = new Set<string>()
    for (const item of r.entries) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return empty(raw, false)
      const e = item as Record<string, unknown>
      if (Object.keys(e).sort().join('|') !== 'count|id|note' ||
        !valid(e as ShoppingPick) || ids.has(e.id as string)) return empty(raw, false)
      ids.add(e.id as string)
      entries.push({ id: e.id as string, count: e.count as number, note: e.note as string })
    }
    return { entries, raw, writable: true }
  } catch { return empty(raw, false) }
}
export function saveUnpricedShoppingDetails(
  previous: ShoppingDetails, entries: readonly ShoppingPick[],
): ShoppingDetails | null {
  if (typeof window === 'undefined' || !previous.writable || entries.length > 100 ||
    entries.some(x => !valid(x)) || new Set(entries.map(e => e.id)).size !== entries.length)
    return null
  try {
    if (window.localStorage.getItem(unpricedShoppingDetailsKey) !== previous.raw) return null
    const raw = JSON.stringify({ schemaVersion: 1, entries })
    if (raw.length > 32000) return null
    window.localStorage.setItem(unpricedShoppingDetailsKey, raw)
    return { entries: [...entries], raw, writable: true }
  } catch { return null }
}
export function clearUnpricedShoppingDetails(id: string): void {
  if (!validId(id)) return
  const snapshot = readUnpricedShoppingDetails()
  if (!snapshot.writable || !snapshot.entries.some(e => e.id === id)) return
  saveUnpricedShoppingDetails(snapshot, snapshot.entries.filter(e => e.id !== id))
}
