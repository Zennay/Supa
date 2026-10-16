import { createManualRecipeDraft, type UserRecipeDraft } from '../../domain/userRecipeImport.ts'

export type SavedRecipe = UserRecipeDraft & { id: string; savedAt: string }
export const RECIPE_LIBRARY_KEY = 'supa.recipe-library.v1'
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>
export type LibraryState = { recipes: SavedRecipe[]; raw: string | null; error: string | null }

/** Keep the original ingredient text as well as normalized g/ml/piece fields. */
export function reviewRecipe(draft: UserRecipeDraft): UserRecipeDraft {
  const reviewed = createManualRecipeDraft({
    title: draft.title, servings: draft.servings, minutes: draft.minutes,
    ingredients: draft.ingredients.map(i => i.original), steps: draft.steps,
  })
  if (!reviewed.steps.length) throw new Error('Voeg minstens één bereidingsstap toe.')
  return { ...reviewed, source: draft.source, sourceUrl: draft.sourceUrl }
}

export function readRecipeLibrary(storage: Storage): LibraryState {
  let raw: string | null = null
  try {
    raw = storage.getItem(RECIPE_LIBRARY_KEY)
    if (raw === null) return { raw, recipes: [], error: null }
    if (raw.length > 2_000_000) throw new Error('size')
    const value = JSON.parse(raw)
    if (value.version !== 1 || !Array.isArray(value.recipes) || value.recipes.length > 100) throw new Error('shape')
    const ids = new Set<string>()
    const recipes = value.recipes.map((r: SavedRecipe) => {
      if (!r || typeof r.id !== 'string' || !r.id.startsWith('own-') || ids.has(r.id) ||
          typeof r.savedAt !== 'string' || !Number.isFinite(Date.parse(r.savedAt)) ||
          !['manual', 'url'].includes(r.source) || !Array.isArray(r.ingredients) || !Array.isArray(r.steps) ||
          !r.steps.every(s => typeof s === 'string') || !r.ingredients.every(i => i && typeof i.original === 'string')) throw new Error('record')
      if (r.source === 'url') {
        const url = new URL(r.sourceUrl ?? '')
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('url')
      } else if (r.sourceUrl !== null) throw new Error('url')
      ids.add(r.id)
      return { ...reviewRecipe(r), id: r.id, savedAt: r.savedAt }
    })
    return { raw, recipes, error: null }
  } catch {
    return { raw, recipes: [], error: 'Je opgeslagen recepten kunnen niet worden gelezen. Ze blijven bewaard; opslaan is tijdelijk uitgeschakeld.' }
  }
}

export function saveRecipeLibrary(storage: Storage, previous: LibraryState, recipes: SavedRecipe[]): LibraryState {
  if (previous.error) throw new Error(previous.error)
  if (recipes.length > 100) throw new Error('Je kunt maximaal 100 eigen recepten bewaren.')
  if (storage.getItem(RECIPE_LIBRARY_KEY) !== previous.raw) throw new Error('Je recepten zijn in een ander tabblad gewijzigd. Herlaad de pagina voordat je opslaat.')
  const raw = JSON.stringify({ version: 1, recipes })
  if (raw.length > 2_000_000) throw new Error('Je receptenverzameling is te groot om op dit apparaat te bewaren.')
  const checked = readRecipeLibrary({ getItem: () => raw, setItem() {} })
  if (checked.error) throw new Error('Controleer je recept voordat je het opslaat.')
  storage.setItem(RECIPE_LIBRARY_KEY, raw)
  return { recipes: checked.recipes, raw, error: null }
}
