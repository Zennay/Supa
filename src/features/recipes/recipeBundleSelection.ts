import type { SavedRecipe } from './recipeLibrary.ts'

/**
 * Explicit, private file transfer of a user's recipe bundle and tentative
 * weekdays. A bundle never contains retailer prices, matches or stock facts.
 * Every row is bound to the original saved recipe bytes; a changed recipe
 * must be reviewed again instead of silently reusing an old shopping plan.
 */
export type BundleSelection = {
  selectedIds: string[]
  portionsById: Record<string, number>
  dayOverrides: Record<string, string>
  startDay: string
}

const kind = 'supa-private-recipe-bundle-v1'
export const recipeBundleMaxBytes = 256_000
const maximumRecipes = 15

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key))
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function allowedDay(day: unknown, days: readonly string[]): day is string {
  return typeof day === 'string' && days.includes(day)
}

export function exportRecipeBundleSelection(
  selected: readonly SavedRecipe[],
  portionsById: Readonly<Record<string, number>>,
  dayOverrides: Readonly<Record<string, string>>,
  startDay: string,
  days: readonly string[],
): string {
  if (!selected.length || selected.length > maximumRecipes || !allowedDay(startDay, days) ||
    new Set(selected.map(recipe => recipe.id)).size !== selected.length)
    throw new Error('Kies 1 tot 15 unieke recepten en een geldige begindag.')
  const entries = selected.map(recipe => {
    const portions = Object.hasOwn(portionsById, recipe.id)
      ? portionsById[recipe.id] : recipe.servings
    if (typeof portions !== "number" || !Number.isSafeInteger(portions) || portions < 1 || portions > 100)
      throw new Error('Controleer eerst de gewenste porties (1 tot 100).')
    const day = Object.hasOwn(dayOverrides, recipe.id) ? dayOverrides[recipe.id] : null
    if (day !== null && !allowedDay(day, days))
      throw new Error('Een gekozen weekdag is niet geldig.')
    return { id: recipe.id, recipeSnapshot: JSON.stringify(recipe), portions, day }
  })
  const json = JSON.stringify({ kind, schemaVersion: 1, startDay, entries })
  if (new TextEncoder().encode(json).length > recipeBundleMaxBytes)
    throw new Error('Deze receptenbundel is te groot voor één privébestand.')
  return json
}

export function importRecipeBundleSelection(
  json: string,
  recipes: readonly SavedRecipe[],
  days: readonly string[],
): BundleSelection {
  if (new TextEncoder().encode(json).length > recipeBundleMaxBytes)
    throw new Error('Kies een receptenbundel van maximaal 256 kB.')
  let data: unknown
  try { data = JSON.parse(json) } catch {
    throw new Error('Dit is geen geldig Supa-receptenbundelbestand.')
  }
  if (!object(data) || !exactKeys(data, ['kind', 'schemaVersion', 'startDay', 'entries']) ||
    data.kind !== kind || data.schemaVersion !== 1 ||
    !allowedDay(data.startDay, days) || !Array.isArray(data.entries) ||
    data.entries.length < 1 || data.entries.length > maximumRecipes)
    throw new Error('Dit bestand bevat geen ondersteunde Supa-receptenbundel.')
  const byId = new Map(recipes.map(recipe => [recipe.id, recipe]))
  const seen = new Set<string>()
  const selectedIds: string[] = []
  const portionsById: Record<string, number> = Object.create(null)
  const dayOverrides: Record<string, string> = Object.create(null)
  for (const entry of data.entries) {
    if (!object(entry) || !exactKeys(entry, ['id', 'recipeSnapshot', 'portions', 'day']) ||
      typeof entry.id !== 'string' || !entry.id || seen.has(entry.id) ||
      typeof entry.recipeSnapshot !== 'string' ||
      !Number.isSafeInteger(entry.portions) || (entry.portions as number) < 1 ||
      (entry.portions as number) > 100 ||
      (entry.day !== null && !allowedDay(entry.day, days)))
      throw new Error('Het receptenbundelbestand heeft ongeldige of dubbele keuzes.')
    seen.add(entry.id)
    const current = byId.get(entry.id)
    if (!current || JSON.stringify(current) !== entry.recipeSnapshot)
      throw new Error('Een recept is gewijzigd of ontbreekt. Controleer je bibliotheek en maak daarna een nieuw bundelbestand.')
    selectedIds.push(entry.id)
    portionsById[entry.id] = entry.portions as number
    if (entry.day !== null) dayOverrides[entry.id] = entry.day as string
  }
  return { selectedIds, portionsById, dayOverrides, startDay: data.startDay }
}
