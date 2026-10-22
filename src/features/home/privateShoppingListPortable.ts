import type { ShoppingDetails } from './unpricedShoppingDetails'
import type { UnpricedShoppingProgress } from './unpricedShoppingProgress'

/** An explicit user-controlled backup, never a retailer capture or basket. */
export type PortableShoppingItem = Readonly<{
  id: string; count: number; note: string; done: boolean
}>
const kind = 'supa-private-unpriced-shopping-list'
const maxBytes = 32768
const validItem = (value: PortableShoppingItem, allowed: ReadonlySet<string>) =>
  allowed.has(value.id) && typeof value.id === 'string' &&
  Number.isSafeInteger(value.count) && value.count >= 1 && value.count <= 99 &&
  typeof value.note === 'string' && value.note.length <= 120 &&
  !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value.note) &&
  typeof value.done === 'boolean'

export function encodePrivateShoppingList(
  ids: readonly string[], details: ShoppingDetails,
  progress: UnpricedShoppingProgress, allowed: ReadonlySet<string>,
): string {
  const items = ids.filter(id => allowed.has(id)).map(id => {
    const saved = details.entries.find(item => item.id === id)
    return { id, count: saved?.count ?? 1, note: saved?.note ?? '',
      done: progress.doneIds.includes(id) }
  })
  if (items.length > 100 || new Set(items.map(x => x.id)).size !== items.length ||
      items.some(item => !validItem(item, allowed)))
    throw Error('Productselectie is niet veilig te exporteren.')
  const text = JSON.stringify({ kind, schemaVersion: 1, items }, null, 2)
  if (new TextEncoder().encode(text).byteLength > maxBytes)
    throw Error('Persoonlijke lijst groter dan 32 KiB. Exporteer minder items.')
  return text
}

export function parsePrivateShoppingList(
  raw: string, allowed: ReadonlySet<string>,
): readonly PortableShoppingItem[] {
  if (!raw || new TextEncoder().encode(raw).byteLength > maxBytes)
    throw Error('Lege of te grote lijst: maximaal 32 KiB UTF-8.')
  let source: unknown
  try { source = JSON.parse(raw) }
  catch { throw Error('Geen geldig persoonlijk boodschappenlijst-JSON.') }
  if (!source || typeof source !== 'object' || Array.isArray(source))
    throw Error('Ongeldige lijststructuur.')
  const r = source as Record<string, unknown>
  if (Object.keys(r).sort().join('|') !== 'items|kind|schemaVersion' ||
      r.kind !== kind || r.schemaVersion !== 1 ||
      !Array.isArray(r.items) || r.items.length > 100)
    throw Error('Onbekende of onveilige lijstversie; bestaande keuzes behouden.')
  const items: PortableShoppingItem[] = []
  const seen = new Set<string>()
  for (const value of r.items) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw Error('Ongeldige productregel.')
    const row = value as Record<string, unknown>
    if (Object.keys(row).sort().join('|') !== 'count|done|id|note' ||
        typeof row.id !== 'string' || !validItem(row as PortableShoppingItem, allowed) ||
        seen.has(row.id))
      throw Error('Onbekende product-ID, dubbele regel of onveilig veld. Geen prijzen of winkeldata toegestaan.')
    seen.add(row.id)
    items.push({ id: row.id, count: row.count as number,
      note: row.note as string, done: row.done as boolean })
  }
  return items
}
