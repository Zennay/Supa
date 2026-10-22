import type { SavedRecipe } from './recipeLibrary.ts'
import { ownRecipeShoppingChecklist } from './recipeShoppingChecklist.ts'
import type { CookingDay } from './RecipeWeekCookingMode.tsx'

export const cookingProgressLimit = 256_000
type ProgressLine = { day: string; recipeId: string; steps: number[]; ingredients: string[] }
type SavedProgress = {
  kind: 'supa-private-cooking-progress-v1'
  identity: string
  entries: ProgressLine[]
}
type CookingProgress = {
  finishedSteps: Record<string, number[]>
  prepared: Record<string, string[]>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key))
}
function isDense(value: unknown): value is unknown[] {
  return Array.isArray(value) &&
    Array.from({ length: value.length }, (_, i) => Object.hasOwn(value, i)).every(Boolean)
}
function snapshotKey(day: string, recipe: SavedRecipe): string {
  return JSON.stringify([day, recipe])
}
/** Full exact week/recipe identity; never infer equivalent recipes from titles. */
function approvedWeek(assignments: readonly CookingDay[], recipes: readonly SavedRecipe[]) {
  if (!assignments.length || assignments.length > 7 ||
      new Set(assignments.map(a => a.day)).size !== assignments.length ||
      new Set(assignments.map(a => a.recipeId)).size !== assignments.length)
    throw Error('Kies een unieke volledige receptenweek om kookvoortgang over te dragen.')
  const byId = new Map(recipes.map(recipe => [recipe.id, recipe]))
  const slots = assignments.map(a => {
    const recipe = byId.get(a.recipeId)
    if (!recipe || JSON.stringify(recipe) !== a.recipeSnapshot ||
        !Array.isArray(recipe.steps) || !recipe.steps.length ||
        recipe.steps.length > 100 ||
        recipe.steps.some(s => typeof s !== 'string' || !s.trim()) ||
        recipe.servings === null) throw Error('De originele recepten zijn gewijzigd of niet kookklaar.')
    const checklist = ownRecipeShoppingChecklist(recipe, recipe.servings)
    if (!checklist.canCopy || checklist.lines.some(line => line.needsReview))
      throw Error('Een ingrediënt vereist nog controle voordat de kookvoortgang kan worden overgedragen.')
    return { day: a.day, recipeId: a.recipeId, key: snapshotKey(a.day, recipe),
      steps: recipe.steps.length, keys: checklist.lines.map(line => line.key) }
  })
  return { slots, identity: JSON.stringify(assignments.map(a =>
    [a.day, a.recipeId, a.recipeSnapshot])) }
}

function validIndexes(input: unknown, limit: number): input is number[] {
  return isDense(input) && input.length <= limit &&
    input.every(x => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && x < limit) &&
    new Set(input).size === input.length
}
function validIngredients(input: unknown, keys: readonly string[]): input is string[] {
  const allowed = new Set(keys)
  return isDense(input) && input.length <= keys.length &&
    input.every(x => typeof x === 'string' && allowed.has(x)) &&
    new Set(input).size === input.length
}
/** Portable private file; no implicit storage or prices. */
export function exportRecipeCookingProgress(
  assignments: readonly CookingDay[], recipes: readonly SavedRecipe[],
  finishedSteps: Readonly<Record<string, number[]>>,
  prepared: Readonly<Record<string, string[]>>,
): string {
  const week = approvedWeek(assignments, recipes)
  const entries = week.slots.map(slot => {
    const steps = Object.hasOwn(finishedSteps, slot.key) ? finishedSteps[slot.key] : []
    const ingredients = Object.hasOwn(prepared, slot.key) ? prepared[slot.key] : []
    if (!validIndexes(steps, slot.steps) || !validIngredients(ingredients, slot.keys))
      throw Error('Kookvoortgang bevat een niet-bestaande stap of ingrediënt.')
    return { day: slot.day, recipeId: slot.recipeId, steps, ingredients }
  })
  const json = JSON.stringify({
    kind: 'supa-private-cooking-progress-v1', identity: week.identity, entries,
  } satisfies SavedProgress)
  if (new TextEncoder().encode(json).length > cookingProgressLimit)
    throw Error('Dit kookvoortgangbestand is groter dan 256 kB.')
  return json
}
export function restoreRecipeCookingProgress(
  text: string, assignments: readonly CookingDay[], recipes: readonly SavedRecipe[],
): CookingProgress {
  if (new TextEncoder().encode(text).length > cookingProgressLimit)
    throw Error('Het privébestand is te groot.')
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch {
    throw Error('Dit is geen geldig Supa-kookvoortgangbestand.')
  }
  const week = approvedWeek(assignments, recipes)
  if (!isRecord(parsed) || !exact(parsed, ['kind', 'identity', 'entries']) ||
      parsed.kind !== 'supa-private-cooking-progress-v1' ||
      parsed.identity !== week.identity || !isDense(parsed.entries) ||
      parsed.entries.length !== week.slots.length)
    throw Error('Dit bestand hoort niet bij deze exacte recepten en kookdagen.')
  const finishedSteps: Record<string, number[]> = Object.create(null)
  const prepared: Record<string, string[]> = Object.create(null)
  for (let i = 0; i < week.slots.length; i++) {
    const slot = week.slots[i]
    const entry = parsed.entries[i]
    if (!isRecord(entry) || !exact(entry, ['day', 'recipeId', 'steps', 'ingredients']) ||
        entry.day !== slot.day || entry.recipeId !== slot.recipeId ||
        !validIndexes(entry.steps, slot.steps) || !validIngredients(entry.ingredients, slot.keys))
      throw Error('Een afvinking hoort niet bij dit receptenweekmenu.')
    finishedSteps[slot.key] = entry.steps
    prepared[slot.key] = entry.ingredients
  }
  return { finishedSteps, prepared }
}
