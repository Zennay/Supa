import { createManualRecipeDraft, type UserRecipeDraft } from '../../domain/userRecipeImport.ts'
import { safeRecipeSourceUrl } from '../../domain/recipeSourceUrl.ts'

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
  // Re-parsing the original measurement is necessary, but it is NOT evidence
  // that a previous human source/conversion warning was resolved. Keep such
  // a warning while its literal source row remains unchanged.
  const ingredients = reviewed.ingredients.map((item, index) => {
    const previous = draft.ingredients[index]
    const pending = previous?.original === item.original &&
      typeof previous.reviewReason === 'string' &&
      previous.reviewReason.length > 0 && previous.reviewReason.length <= 400
      ? previous.reviewReason : null
    return pending ? { ...item, reviewReason: pending } : item
  })
  const extraWarnings = Array.isArray(draft.warnings)
    ? draft.warnings.filter(warning => typeof warning === 'string' &&
        warning.length > 0 && warning.length <= 400 &&
        !/^Ingrediënt \d+:/u.test(warning) &&
        warning !== 'Porties ontbreken of zijn onduidelijk' &&
        warning !== 'Bereidingstijd ontbreekt of is onduidelijk').slice(0, 100)
    : []
  const warnings = Array.from(new Set([
    ...ingredients.flatMap((item, index) => item.reviewReason
      ? ['Ingrediënt ' + (index + 1) + ': ' + item.reviewReason] : []),
    ...reviewed.warnings.filter(warning => !/^Ingrediënt \d+:/u.test(warning)),
    ...extraWarnings,
  ]))
  return {
    ...reviewed, ingredients, warnings, source: draft.source,
    sourceUrl: draft.source === 'url'
      ? safeRecipeSourceUrl(draft.sourceUrl ?? '')
      : null,
  }
}

/**
 * Keep human-review holds when an imported recipe is edited cosmetically.
 * A genuine new amount/unit must be parsed and reviewed again. Source-level
 * warnings never disappear simply because the title or instructions changed.
 */
export function retainUnresolvedRecipeReview(
  fresh: UserRecipeDraft, previous: UserRecipeDraft,
): UserRecipeDraft {
  const ingredients = fresh.ingredients.map((current, index) => {
    const older = previous.ingredients.find(item => item.original === current.original)
      ?? previous.ingredients[index]
    if (!older || typeof older.reviewReason !== 'string' ||
        !older.reviewReason || older.reviewReason.length > 400 ||
        current.reviewReason) return current
    if (older.amount !== current.amount || older.unit !== current.unit) {
      return current
    }
    return { ...current, reviewReason: older.reviewReason }
  })
  const inherited = Array.isArray(previous.warnings) ? previous.warnings.filter(warning =>
    typeof warning === 'string' && warning.length > 0 && warning.length <= 400 &&
    !/^Ingrediënt \d+:/u.test(warning) &&
    warning !== 'Porties ontbreken of zijn onduidelijk' &&
    warning !== 'Bereidingstijd ontbreekt of is onduidelijk') : []
  return {
    ...fresh, ingredients,
    warnings: Array.from(new Set([
      ...ingredients.flatMap((item, index) => item.reviewReason
        ? ['Ingrediënt ' + (index + 1) + ': ' + item.reviewReason] : []),
      ...fresh.warnings.filter(warning => !/^Ingrediënt \d+:/u.test(warning)),
      ...inherited,
    ])),
  }
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
        // Existing private recipes are normalized on read too: neither
        // portable export nor device restore may retain auth query secrets.
        safeRecipeSourceUrl(r.sourceUrl ?? '')
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
