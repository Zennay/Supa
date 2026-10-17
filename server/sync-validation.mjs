import { canReplacePlannerRecord } from '../src/features/planner/plannerStorageGuard.ts'
import { readRecipeLibrary } from '../src/features/recipes/recipeLibrary.ts'
import { toPlannerRecipe } from '../src/features/recipes/plannerRecipes.ts'
import { curatedFigmaRecipes } from '../src/features/recipes/curatedFigmaRecipes.ts'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'

export const PLANNER_KEY = 'supa:planner-preferences:v2'
export const RECIPE_LIBRARY_KEY = 'supa.recipe-library.v1'
export const SHOPPING_PROGRESS_KEY = 'supa:shopping-list-progress:v1'
/** The only browser records that may leave the device. Observation drafts stay local. */
export const SYNC_KEYS = [PLANNER_KEY, RECIPE_LIBRARY_KEY, SHOPPING_PROGRESS_KEY]
export const MAX_SNAPSHOT_BYTES = 2_500_000

const plannerDays = m2InitialPlan.map(meal => meal.day)

function validShoppingProgress(raw) {
  if (raw.length > 200_000) return false
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    if (Object.keys(value).sort().join() !== 'basketKey,doneLineIds,schemaVersion') return false
    return value.schemaVersion === 1 && typeof value.basketKey === 'string' &&
      Array.isArray(value.doneLineIds) && value.doneLineIds.length <= 1000 &&
      value.doneLineIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 500) &&
      new Set(value.doneLineIds).size === value.doneLineIds.length
  } catch { return false }
}

/**
 * Apply the same rules the browser uses before it trusts these records, so the
 * server never stores a record the app would refuse (or silently overwrite).
 */
export function validateSyncEntries(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Ongeldige gegevens.' }
  const keys = Object.keys(input)
  if (keys.some(key => !SYNC_KEYS.includes(key))) return { error: 'Onbekend gegevenstype.' }
  const entries = Object.fromEntries(SYNC_KEYS.map(key => [key, Object.hasOwn(input, key) ? input[key] : null]))
  if (Object.values(entries).some(value => value !== null && typeof value !== 'string')) return { error: 'Ongeldige gegevens.' }
  if (JSON.stringify(entries).length > MAX_SNAPSHOT_BYTES) return { error: 'Je gegevens zijn te groot om te bewaren.' }

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
