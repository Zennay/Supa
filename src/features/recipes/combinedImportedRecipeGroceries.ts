import { sumDecimalAmounts } from '../../domain/decimalPackArithmetic.ts'
import { ownRecipeShoppingChecklist, formatOwnRecipeChecklist, type OwnRecipeChecklist, type OwnRecipeChecklistLine } from './recipeShoppingChecklist.ts'
import { toPlannerRecipe } from './plannerRecipes.ts'
import type { SavedRecipe } from './recipeLibrary.ts'

export type GroceryContribution = {
  recipeId: string
  recipeTitle: string
  ingredientLabel: string
  query: string | null
  original: string
  amount: number | null
  unit: 'g' | 'ml' | 'piece' | null
}

export type CombinedImportedGroceries = {
  contributorsByLine: Record<string, GroceryContribution[]>
  checklist: OwnRecipeChecklist
  recipes: number
  heldRecipes: string[]
  /** Stable IDs: identical recipe titles must not share review status. */
  heldRecipeIds: string[]
  /** The same canonical SKU-facing identity cannot carry different source names. */
  identityConflicts: { query: string; unit: string; entries: { recipeId: string; recipeTitle: string; label: string }[] }[]
  /** This is always unpriced. Only exact matching names + physical units merge. */
  complete: boolean
}

/**
 * Combine the physical requirements of personally imported recipes, NOT
 * store products. A pending recipe-level review makes *all* its ingredients
 * unresolved: one plausible amount must never hide an unreviewed source.
 * This uses the existing single-recipe portion scaler and exact decimal
 * arithmetic; it never manufactures a purchase price or SKU.
 */
export function combinedImportedRecipeGroceries(
  recipes: readonly SavedRecipe[], portionsById: Readonly<Record<string, number>> = {},
): CombinedImportedGroceries {
  if (!Array.isArray(recipes) || recipes.length === 0 || recipes.length > 15 ||
      new Set(recipes.map(recipe => recipe.id)).size !== recipes.length) {
    throw new Error('Kies één tot vijftien verschillende eigen recepten.')
  }
  const lines: OwnRecipeChecklistLine[] = []
  const groups = new Map<string, OwnRecipeChecklistLine>()
  const contributorsByLine: Record<string, GroceryContribution[]> = Object.create(null)
  const heldRecipes: string[] = []
  const heldRecipeIds: string[] = []
  // Planner's aggregatePlanIngredients keys own recipes by query + unit and
  // REJECTS different labels for one identity. Detect this at the unpriced
  // list stage so a seemingly complete combined list never masks that drift.
  const labelsByIdentity = new Map<string, {
    query: string; unit: string
    entries: { recipeId: string; recipeTitle: string; label: string }[]
  }>()
  for (const recipe of recipes) {
    const projected = toPlannerRecipe(recipe, { usage: 'unpriced-demand' })
    for (const ingredient of projected?.ingredients ?? []) {
      const key = JSON.stringify([ingredient.query, ingredient.unit])
      const current = labelsByIdentity.get(key)
      const entry = { recipeId: recipe.id, recipeTitle: recipe.title, label: ingredient.label }
      if (current) {
        if (!current.entries.some(item => item.recipeId === entry.recipeId && item.label === entry.label))
          current.entries.push(entry)
      } else labelsByIdentity.set(key, { query: ingredient.query, unit: ingredient.unit, entries: [entry] })
    }
  }
  const identityConflicts = [...labelsByIdentity.values()].filter(row =>
    new Set(row.entries.map(item => item.label)).size > 1)
  const conflictingKeys = new Set(identityConflicts.map(row => JSON.stringify([row.query, row.unit])))
  for (const recipe of recipes) {
    if (!recipe || typeof recipe.title !== 'string' ||
        !Array.isArray(recipe.ingredients) || !recipe.ingredients.length) {
      throw new Error('Een eigen recept heeft geen leesbare ingrediënten.')
    }
    const portions = Object.hasOwn(portionsById, recipe.id)
      ? portionsById[recipe.id] : recipe.servings
    const validPortions = typeof portions === 'number' &&
      Number.isSafeInteger(portions) && portions >= 1 && portions <= 100
    const ready = validPortions && !!toPlannerRecipe(recipe, { usage: 'unpriced-demand' })
    if (!ready) { heldRecipes.push(recipe.title); heldRecipeIds.push(recipe.id) }
    // The ordinary single-recipe checklist deliberately coalesces duplicate
    // product identities. Here, retain EACH original ingredient as a separate
    // contribution first: otherwise a recipe containing two flour rows would
    // show their combined 300 g as if it came from only the first 100 g row.
    // The canonical per-ingredient scaler/guards still come from the existing
    // checklist; cross-recipe physical aggregation happens below.
    const unresolved = (ingredient: SavedRecipe['ingredients'][number], index: number): OwnRecipeChecklistLine => ({
      key: String(index), label: ingredient.label || ingredient.original,
      amount: null, unit: null, original: ingredient.original, needsReview: true,
    })
    const sourceLines = recipe.ingredients.map((ingredient: SavedRecipe['ingredients'][number], index: number) => {
      if (!ready) return unresolved(ingredient, index)
      const isolated = ownRecipeShoppingChecklist(
        { ...recipe, ingredients: [ingredient] }, portions)
      return isolated.lines[0] ?? unresolved(ingredient, index)
    })
    for (const item of sourceLines) {
      const complete = ready && !item.needsReview && item.amount !== null &&
        item.unit !== null && Number.isFinite(item.amount) && item.amount > 0
      const label = typeof item.label === 'string' ? item.label.trim() : ''
      // Mirror the canonical Planner ingredient identity, NOT a display
      // label that may be spelled the same for physically different items.
      const groupKey = complete && typeof item.query === 'string' && item.query.trim()
        ? JSON.stringify([item.query, item.unit]) : null
      const conflictingIdentity = groupKey !== null && conflictingKeys.has(groupKey)
      // Keep each original source visible and unresolved instead of combining
      // different labels behind the same matching identity.
      const safeGroupKey = conflictingIdentity ? null : groupKey
      const contribution: GroceryContribution = {
        recipeId: recipe.id, recipeTitle: recipe.title,
        ingredientLabel: label || item.original,
        query: groupKey && typeof item.query === 'string' ? item.query : null,
        original: item.original,
        amount: complete ? item.amount : null, unit: complete ? item.unit : null,
      }
      const prior = safeGroupKey ? groups.get(safeGroupKey) : null
      if (prior) contributorsByLine[prior.key].push(contribution)
      if (prior) {
        const total = sumDecimalAmounts([prior.amount!, item.amount!])
        if (total !== null && total <= 1_000_000 &&
            (item.unit !== 'piece' || Number.isSafeInteger(total))) {
          prior.amount = total
          continue
        }
        // Overflow / fractional pieces are not valid product requirements.
        // Hold the whole grouped quantity for human review instead.
        prior.original += ' + ' + item.original
        prior.amount = null; prior.unit = null; prior.needsReview = true
        groups.delete(safeGroupKey!)
        continue
      }
      const line: OwnRecipeChecklistLine = {
        key: String(lines.length),
        label: label || recipe.title,
        query: safeGroupKey ? item.query : undefined,
        amount: complete && !conflictingIdentity ? item.amount : null,
        unit: complete && !conflictingIdentity ? item.unit : null,
        needsReview: !complete || conflictingIdentity,
        original: item.original,
      }
      lines.push(line)
      contributorsByLine[line.key] = [contribution]
      if (safeGroupKey) groups.set(safeGroupKey, line)
    }
  }
  const checklist: OwnRecipeChecklist = {
    title: 'Mijn geïmporteerde recepten',
    portions: 1,
    recipeCount: recipes.length,
    lines, canCopy: lines.length > 0, copyText: '',
  }
  checklist.copyText = formatOwnRecipeChecklist(checklist, {})
  return {
    checklist, contributorsByLine, recipes: recipes.length, heldRecipes, heldRecipeIds, identityConflicts,
    complete: !heldRecipes.length && !identityConflicts.length && lines.every(line => !line.needsReview),
  }
}
