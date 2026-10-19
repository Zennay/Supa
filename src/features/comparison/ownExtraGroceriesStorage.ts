export type Unit = 'g' | 'ml' | 'piece'
export type Item = { id: string; name: string; quantity: number; unit: Unit; done: boolean }
export const legacyKey = 'supa:extra-groceries-tab:v1'
// Every exact physical Planner demand has its own private tab snapshot.
// Hash collisions cannot cross-restore: decodeSaved checks full identity.
export function storageKey(identity: string) {
  let hash = 2166136261
  for (let i = 0; i < identity.length; i++) {
    hash ^= identity.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return legacyKey + ':' + (hash >>> 0).toString(16)
}
export const valid = (x: Item) => /^[\w-]{1,100}$/.test(x.id) &&
  typeof x.name === 'string' && x.name.length > 0 && x.name.length <= 120 &&
  x.name === x.name.trim() && /[\p{L}\p{N}]/u.test(x.name) &&
  !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(x.name) &&
  Number.isFinite(x.quantity) && x.quantity > 0 && x.quantity <= 100000 &&
  ['g','ml','piece'].includes(x.unit) && (x.unit !== 'piece' || Number.isSafeInteger(x.quantity)) &&
  typeof x.done === 'boolean'
export function decodeSaved(raw: string, identity: string) {
  if (new TextEncoder().encode(raw).length > 100000) throw Error('size')
  const v: unknown = JSON.parse(raw)
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('shape')
  const record = v as Record<string, unknown>
  if (record.schema !== 'supa-extra-v1' || typeof record.identity !== 'string' ||
      !Array.isArray(record.items) || record.items.length > 100 ||
      Object.keys(record).some(k => !['schema', 'identity', 'items'].includes(k)) ||
      !record.items.every((item: unknown) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false
        const row = item as Record<string, unknown>
        return Object.keys(row).length === 5 &&
          Object.keys(row).every(k => ['id', 'name', 'quantity', 'unit', 'done'].includes(k)) &&
          typeof row.id === 'string' && valid(row as Item)
      }) ||
      new Set(record.items.map((item: Item) => item.id)).size !== record.items.length)
    throw Error('shape')
  if (record.identity !== identity) throw Error('other-week')
  return record.items as Item[]
}
export function restore(identity: string) {
  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(storageKey(identity))
    if (raw !== null) return { items: decodeSaved(raw, identity), raw, locked: false }
    // Backward-compatible, read-only recovery of the original single-week
    // format. Never delete the legacy record belonging to another week.
    const legacy = sessionStorage.getItem(legacyKey)
    if (legacy !== null) {
      try { return { items: decodeSaved(legacy, identity), raw: null, locked: false } }
      catch { /* Another week or corrupt legacy entry: retain it untouched. */ }
    }
    return { items: [] as Item[], raw: null, locked: false }
  } catch { return { items: [] as Item[], raw, locked: true } }
}

/** Only the explicit tab-saved extra list for this exact Planner demand. */
export function readSavedExtrasForPlan(identity: string): { items: Item[]; available: boolean } {
  const snapshot = restore(identity)
  return { items: snapshot.items, available: !snapshot.locked }
}

export type ReusableExtraList = Readonly<{
  identity: string
  items: readonly Item[]
  label: string
}>

/** Read-only discovery of other private week lists saved in THIS browser tab.
 * Never transfers a source match, price, or already-checked state.
 */
export function findReusableExtraLists(currentIdentity: string): ReusableExtraList[] {
  try {
    const keys: string[] = []
    // Session storage is bounded by the browser, but discovery is further
    // capped so a hostile page cannot turn one click into an unbounded scan.
    const count = Math.min(sessionStorage.length, 400)
    for (let index = 0; index < count; index++) {
      const key = sessionStorage.key(index)
      if (key && (key === legacyKey || key.startsWith(legacyKey + ':'))) keys.push(key)
    }
    const unique = new Set<string>()
    const lists: ReusableExtraList[] = []
    for (const key of keys.slice(0, 60)) {
      const raw = sessionStorage.getItem(key)
      if (!raw || new TextEncoder().encode(raw).length > 100000) continue
      let identity: unknown
      try { identity = (JSON.parse(raw) as { identity?: unknown }).identity }
      catch { continue }
      if (typeof identity !== 'string' || identity.length > 100000 ||
          identity === currentIdentity || unique.has(identity) ||
          (key !== legacyKey && storageKey(identity) !== key)) continue
      try {
        const items = decodeSaved(raw, identity)
        if (!items.length) continue
        unique.add(identity)
        const first = items.slice(0, 2).map(item => item.name).join(', ')
        lists.push({ identity, items, label: items.length + ' artikelen · ' + first })
      } catch { /* Foreign/corrupted records are left entirely untouched. */ }
      if (lists.length === 12) break
    }
    return lists
  } catch { return [] }
}
