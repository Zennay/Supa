import {
  readRecipeLibrary, type SavedRecipe,
} from './recipeLibrary.ts'

/**
 * Explicit user-owned, portable recipe backup. No supermarket source data,
 * pricing, logins, server transport or automatic browser storage changes.
 */
export const RECIPE_BACKUP_SCHEMA = 'supa-owned-recipes-backup-v1'
export const RECIPE_BACKUP_MAX_BYTES = 2_000_000
const utf8Size = (value: string) => new TextEncoder().encode(value).length

function normalizedRecords(input: unknown): SavedRecipe[] {
  if (!Array.isArray(input) || input.length > 100) {
    throw new Error('Het bestand mag maximaal 100 eigen recepten bevatten.')
  }
  // Reuse EXACTLY the existing recipe store admission / metric normalizer.
  const raw = JSON.stringify({ version: 1, recipes: input })
  if (utf8Size(raw) > RECIPE_BACKUP_MAX_BYTES) {
    throw new Error('De receptenverzameling is groter dan 2 MB.')
  }
  const parsed = readRecipeLibrary({ getItem: () => raw, setItem() {} })
  if (parsed.error) {
    throw new Error('Een of meer recepten hebben een onbekende of ongeldige vorm.')
  }
  return parsed.recipes
}

export function serializeRecipeBackup(recipes: readonly SavedRecipe[]): string {
  const reviewed = normalizedRecords([...recipes])
  const output = JSON.stringify({
    schema: RECIPE_BACKUP_SCHEMA,
    recipes: reviewed,
  }, null, 2) + '\n'
  if (utf8Size(output) > RECIPE_BACKUP_MAX_BYTES) {
    throw new Error('Het exportbestand is groter dan 2 MB.')
  }
  return output
}

export type RecipeBackupPreview = {
  additions: SavedRecipe[]
  alreadyPresent: number
  sourceCount: number
}

export function prepareRecipeBackupImport(
  text: string,
  existing: readonly SavedRecipe[],
): RecipeBackupPreview {
  if (typeof text !== 'string' || utf8Size(text) > RECIPE_BACKUP_MAX_BYTES) {
    throw new Error('Selecteer een UTF-8 receptenbackup van maximaal 2 MB.')
  }
  let root: unknown
  try { root = JSON.parse(text) }
  catch { throw new Error('Dit is geen geldig JSON-receptenbestand.') }
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error('Het receptenbestand heeft geen geldige structuur.')
  }
  const record = root as Record<string, unknown>
  if (record.schema !== RECIPE_BACKUP_SCHEMA ||
      Object.keys(record).some(key => key !== 'schema' && key !== 'recipes')) {
    throw new Error('Onbekende of nieuwere receptenbackup. Bestaande recepten blijven onaangeroerd.')
  }
  const imported = normalizedRecords(record.recipes)
  if (!imported.length) {
    throw new Error('Er staan geen eigen recepten in dit bestand.')
  }
  const byId = new Map(existing.map(recipe => [recipe.id, recipe]))
  if (byId.size !== existing.length) {
    throw new Error('De huidige receptenverzameling bevat dubbele ID’s.')
  }
  let alreadyPresent = 0
  const additions: SavedRecipe[] = []
  for (const recipe of imported) {
    const old = byId.get(recipe.id)
    if (!old) {
      additions.push(recipe)
    } else if (JSON.stringify(old) === JSON.stringify(recipe)) {
      alreadyPresent++
    } else {
      // ID collisions are not silently overwritten or renamed: a different
      // recipe could otherwise hijack someone's currently planned meals.
      throw new Error('Een recept-ID bestaat al met andere inhoud. Er is niets geïmporteerd.')
    }
  }
  if (existing.length + additions.length > 100) {
    throw new Error('Met deze import zou je meer dan 100 eigen recepten hebben.')
  }
  return { additions, alreadyPresent, sourceCount: imported.length }
}
