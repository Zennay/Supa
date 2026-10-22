/**
 * Private checklist ticks for the separately selected, never-priced discovery
 * products. This key intentionally cannot be mistaken for the canonical
 * physical store/product review or paid shopping-trip state.
 */
export const unpricedShoppingProgressKey = 'supa:unpriced-selected-product-ticks:v1'

export type UnpricedShoppingProgress = Readonly<{
  doneIds: string[]
  raw: string | null
  writable: boolean
}>

const validId = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0 && id.length <= 100 &&
  !/[\u0000-\u001f\u007f-\u009f]/u.test(id)

export function readUnpricedShoppingProgress(): UnpricedShoppingProgress {
  if (typeof window === 'undefined') return { doneIds: [], raw: null, writable: false }
  try {
    const raw = window.localStorage.getItem(unpricedShoppingProgressKey)
    if (raw === null) return { doneIds: [], raw, writable: true }
    const unknown: unknown = JSON.parse(raw)
    if (!unknown || typeof unknown !== 'object' || Array.isArray(unknown))
      return { doneIds: [], raw, writable: false }
    const record = unknown as Record<string, unknown>
    const ids = record.doneIds
    if (Object.keys(record).sort().join('|') !== 'doneIds|schemaVersion' ||
        record.schemaVersion !== 1 || !Array.isArray(ids) ||
        ids.length > 100 || !ids.every(validId) ||
        new Set(ids).size !== ids.length)
      return { doneIds: [], raw, writable: false }
    return { doneIds: ids, raw, writable: true }
  } catch {
    return { doneIds: [], raw: null, writable: false }
  }
}

/** Compare-and-set protects unknown future schema and edits in another tab. */
export function saveUnpricedShoppingProgress(
  previous: UnpricedShoppingProgress, doneIds: readonly string[],
): UnpricedShoppingProgress | null {
  if (typeof window === 'undefined' || !previous.writable ||
      doneIds.length > 100 || !doneIds.every(validId) ||
      new Set(doneIds).size !== doneIds.length) return null
  try {
    if (window.localStorage.getItem(unpricedShoppingProgressKey) !== previous.raw) return null
    const raw = JSON.stringify({ schemaVersion: 1, doneIds })
    window.localStorage.setItem(unpricedShoppingProgressKey, raw)
    return { doneIds: [...doneIds], raw, writable: true }
  } catch {
    return null
  }
}

/** Removing a catalog selection must not resurrect its old completed tick
 * when that same example is added again from Producten.
 */
export function clearUnpricedShoppingProduct(id: string): void {
  if (!validId(id)) return
  const snapshot = readUnpricedShoppingProgress()
  if (!snapshot.writable || !snapshot.doneIds.includes(id)) return
  saveUnpricedShoppingProgress(snapshot, snapshot.doneIds.filter(value => value !== id))
}
