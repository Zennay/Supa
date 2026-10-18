/** Private local-only favorites, completely separate from retailer-price evidence. */
export const RECIPE_FAVORITES_KEY = 'supa.recipe-favorites.v1'
type StorageLike = Pick<globalThis.Storage, 'getItem' | 'setItem'>
export type FavoriteState = { ids: string[]; raw: string | null; error: string | null }

function validId(id: unknown): id is string {
  return typeof id === 'string' && /^(?:own-|supa-)[a-zA-Z0-9_-]{1,120}$/.test(id)
}

export function readRecipeFavorites(storage: StorageLike): FavoriteState {
  let raw: string | null = null
  try {
    raw = storage.getItem(RECIPE_FAVORITES_KEY)
    if (raw === null) return { ids: [], raw, error: null }
    if (raw.length > 20_000) throw new Error('size')
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape')
    const doc = value as { version?: unknown; ids?: unknown }
    if (doc.version !== 1 || !Array.isArray(doc.ids) || doc.ids.length > 200 ||
      !doc.ids.every(validId) || new Set(doc.ids).size !== doc.ids.length) throw new Error('shape')
    return { ids: doc.ids, raw, error: null }
  } catch {
    return { ids: [], raw, error: 'Favorieten konden niet worden gelezen. Ze worden niet overschreven.' }
  }
}

function write(storage: StorageLike, previous: FavoriteState, ids: string[]): FavoriteState {
  if (previous.error) throw new Error(previous.error)
  if (storage.getItem(RECIPE_FAVORITES_KEY) !== previous.raw) {
    throw new Error('Favorieten zijn in een ander tabblad gewijzigd. Probeer het opnieuw.')
  }
  if (ids.length > 200 || !ids.every(validId) || new Set(ids).size !== ids.length) {
    throw new Error('Te veel of ongeldige favorieten.')
  }
  const raw = JSON.stringify({ version: 1, ids })
  storage.setItem(RECIPE_FAVORITES_KEY, raw)
  return { ids, raw, error: null }
}

export function toggleRecipeFavorite(storage: StorageLike, id: string): FavoriteState {
  if (!validId(id)) throw new Error('Dit recept kan niet als favoriet worden opgeslagen.')
  const previous = readRecipeFavorites(storage)
  return write(storage, previous, previous.ids.includes(id)
    ? previous.ids.filter(value => value !== id) : [...previous.ids, id])
}

export function removeRecipeFavorite(storage: StorageLike, id: string): FavoriteState {
  const previous = readRecipeFavorites(storage)
  if (!previous.ids.includes(id)) return previous
  return write(storage, previous, previous.ids.filter(value => value !== id))
}
