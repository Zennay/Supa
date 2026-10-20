import { canReplacePlannerRecord } from '../features/planner/plannerStorageGuard.ts'
import { readRecipeLibrary } from '../features/recipes/recipeLibrary.ts'
import { toPlannerRecipe } from '../features/recipes/plannerRecipes.ts'
import { curatedFigmaRecipes } from '../features/recipes/curatedFigmaRecipes.ts'
import { m2InitialPlan, m2Recipes } from '../data/m2Fixture.ts'

/**
 * One definition of a valid device-sync snapshot, shared by the server (PUT
 * and disk reads) and the browser (pull and 409 merge), so neither side ever
 * trusts a record the app itself would refuse.
 */
export const PLANNER_KEY = 'supa:planner-preferences:v2'
export const RECIPE_LIBRARY_KEY = 'supa.recipe-library.v1'
export const SHOPPING_PROGRESS_KEY = 'supa:shopping-list-progress:v1'
/** The only browser records that may leave the device. Observation drafts stay local. */
export const SYNC_KEYS = [PLANNER_KEY, RECIPE_LIBRARY_KEY, SHOPPING_PROGRESS_KEY] as const
export const MAX_SNAPSHOT_BYTES = 2_500_000

export type SyncKey = typeof SYNC_KEYS[number]
export type SyncEntries = Record<SyncKey, string | null>

const plannerDays = m2InitialPlan.map(meal => meal.day)

function validShoppingProgress(raw: string) {
  if (raw.length > 200_000) return false
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    if (Object.keys(value).sort().join() !== 'basketKey,doneLineIds,schemaVersion') return false
    return value.schemaVersion === 1 && typeof value.basketKey === 'string' &&
      Array.isArray(value.doneLineIds) && value.doneLineIds.length <= 1000 &&
      value.doneLineIds.every((id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 500) &&
      new Set(value.doneLineIds).size === value.doneLineIds.length
  } catch { return false }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype

/**
 * Validate a snapshot. Missing keys default to null (a PUT may omit them);
 * with `complete`, all three keys must be present, as in every stored
 * revision, so a partial record is never read as deliberate deletions.
 */
export function validateSyncEntries(input: unknown, { complete = false } = {}): { entries: SyncEntries; error?: undefined } | { error: string; entries?: undefined } {
  if (!isPlainObject(input)) return { error: 'Ongeldige gegevens.' }
  const keys = Object.keys(input)
  if (keys.some(key => !(SYNC_KEYS as readonly string[]).includes(key))) return { error: 'Onbekend gegevenstype.' }
  if (complete && keys.length !== SYNC_KEYS.length) return { error: 'Onvolledige gegevens.' }
  const entries = Object.fromEntries(SYNC_KEYS.map(key => [key, Object.hasOwn(input, key) ? input[key] : null])) as SyncEntries
  if (Object.values(entries).some(value => value !== null && typeof value !== 'string')) return { error: 'Ongeldige gegevens.' }
  if (new TextEncoder().encode(JSON.stringify(entries)).length > MAX_SNAPSHOT_BYTES) return { error: 'Je gegevens zijn te groot om te bewaren.' }

  const libraryRaw = entries[RECIPE_LIBRARY_KEY]
  const library = readRecipeLibrary({ getItem: () => libraryRaw, setItem() {} })
  if (library.error) return { error: 'Je recepten konden niet worden gecontroleerd.' }

  const plannerRaw = entries[PLANNER_KEY]
  const validRecipeIds = [
    ...m2Recipes, ...curatedFigmaRecipes,
    ...library.recipes.flatMap(recipe => { const projected = toPlannerRecipe(recipe); return projected ? [projected] : [] }),
  ].map(recipe => recipe.id)
  if (plannerRaw !== null && !canReplacePlannerRecord(plannerRaw, plannerDays, validRecipeIds)) {
    return { error: 'Je weekplanning kon niet worden gecontroleerd.' }
  }

  const shoppingRaw = entries[SHOPPING_PROGRESS_KEY]
  if (shoppingRaw !== null && !validShoppingProgress(shoppingRaw)) return { error: 'Je boodschappenlijst kon niet worden gecontroleerd.' }
  return { entries }
}

/**
 * A server snapshot as the browser receives it (GET 200 or the 409 body):
 * revision 0 is the empty device; any later revision carries a complete,
 * valid snapshot. Returns null for anything else.
 */
export function admitRemoteSnapshot(value: unknown): { revision: number; entries: Partial<SyncEntries> } | null {
  if (!isPlainObject(value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) return null
  const revision = value.revision as number
  if (revision === 0) return isPlainObject(value.entries) && Object.keys(value.entries).length === 0 ? { revision, entries: {} } : null
  const checked = validateSyncEntries(value.entries, { complete: true })
  return checked.error ? null : { revision, entries: checked.entries! }
}
