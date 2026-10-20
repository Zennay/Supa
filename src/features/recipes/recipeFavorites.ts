/** Only opaque recipe IDs are stored locally; never recipe bodies or URLs. */
export const RECIPE_FAVORITES_KEY = 'supa:recipe-favorites:v1'
export type RecipeFavorites = {
  ids: string[]
  raw: string | null
  error: string | null
}

const safeId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 200 &&
  !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)

export function readRecipeFavorites(storage: Storage): RecipeFavorites {
  let raw: string | null
  try { raw = storage.getItem(RECIPE_FAVORITES_KEY) }
  catch { return { ids: [], raw: null, error: 'Browseropslag is niet beschikbaar.' } }
  if (raw === null) return { ids: [], raw, error: null }
  try {
    if (new TextEncoder().encode(raw).byteLength > 240_000) throw Error('oversize')
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('shape')
    const obj = data as Record<string, unknown>
    if (Object.keys(obj).sort().join(',') !== 'ids,schema' ||
        obj.schema !== 'supa-recipe-favorites-v1' ||
        !Array.isArray(obj.ids) || obj.ids.length > 1000 ||
        !obj.ids.every(safeId) ||
        new Set(obj.ids).size !== obj.ids.length) throw Error('invalid ids')
    return { ids: obj.ids, raw, error: null }
  } catch {
    return { ids: [], raw, error: 'Onbekende of ongeldige bewaarde favorieten zijn beschermd tegen overschrijven.' }
  }
}

export function toggleRecipeFavorite(storage: Storage, current: RecipeFavorites, id: string): RecipeFavorites {
  if (current.error || !safeId(id)) throw Error('Favorieten zijn niet veilig te wijzigen.')
  const actual = storage.getItem(RECIPE_FAVORITES_KEY)
  if (actual !== current.raw) throw Error('Favorieten zijn in een andere tab gewijzigd. Ververs de lijst en probeer het opnieuw.')
  const ids = current.ids.includes(id)
    ? current.ids.filter(item => item !== id)
    : [...current.ids, id]
  if (ids.length > 1000) throw Error('Je kunt maximaal 1.000 recepten favoriet maken.')
  const raw = JSON.stringify({ schema: 'supa-recipe-favorites-v1', ids })
  storage.setItem(RECIPE_FAVORITES_KEY, raw)
  return { ids, raw, error: null }
}
