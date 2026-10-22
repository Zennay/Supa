/** Local-only checklist ticks for unpriced discovery products, never price evidence. */
export const unpricedShoppingProgressKey = 'supa:unpriced-selected-product-ticks:v1'
export type UnpricedShoppingProgress = Readonly<{
  doneIds: string[]
  raw: string | null
  writable: boolean
}>
const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 100 &&
  !/[\u0000-\u001f\u007f-\u009f\p{Cf}]/u.test(value)
const empty = (raw: string | null, writable: boolean): UnpricedShoppingProgress =>
  ({ doneIds: [], raw, writable })

export function readUnpricedShoppingProgress(): UnpricedShoppingProgress {
  if (typeof window === 'undefined') return empty(null, false)
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(unpricedShoppingProgressKey)
    if (raw === null) return empty(raw, true)
    if (new TextEncoder().encode(raw).byteLength > 32000) return empty(raw, false)
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return empty(raw, false)
    const record = value as Record<string, unknown>
    const ids = record.doneIds
    if (Object.keys(record).sort().join('|') !== 'doneIds|schemaVersion' ||
        record.schemaVersion !== 1 || !Array.isArray(ids) || ids.length > 100 ||
        !ids.every(validId) || new Set(ids).size !== ids.length) return empty(raw, false)
    return { doneIds: ids, raw, writable: true }
  } catch {
    return empty(raw, false)
  }
}

/** Compare-and-set protects data changed by another tab or a future schema. */
export function saveUnpricedShoppingProgress(
  previous: UnpricedShoppingProgress, doneIds: readonly string[],
): UnpricedShoppingProgress | null {
  if (typeof window === 'undefined' || !previous.writable || doneIds.length > 100 ||
      !doneIds.every(validId) || new Set(doneIds).size !== doneIds.length) return null
  try {
    if (window.localStorage.getItem(unpricedShoppingProgressKey) !== previous.raw) return null
    const raw = JSON.stringify({ schemaVersion: 1, doneIds })
    if (new TextEncoder().encode(raw).byteLength > 32000) return null
    window.localStorage.setItem(unpricedShoppingProgressKey, raw)
    return { doneIds: [...doneIds], raw, writable: true }
  } catch {
    return null
  }
}
