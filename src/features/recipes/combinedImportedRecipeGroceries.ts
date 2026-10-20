import { sumDecimalAmounts } from '../../domain/decimalPackArithmetic.ts'
import { ownRecipeShoppingChecklist, formatOwnRecipeChecklist, type OwnRecipeChecklist, type OwnRecipeChecklistLine } from './recipeShoppingChecklist.ts'
import { toPlannerRecipe } from './plannerRecipes.ts'
import type { SavedRecipe } from './recipeLibrary.ts'

export type CombinedImportedGroceries = {
  checklist: OwnRecipeChecklist
  recipes: number
  heldRecipes: string[]
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
export function combinedImportedRecipeGroceries(recipes: readonly SavedRecipe[]): CombinedImportedGroceries {
  if (!Array.isArray(recipes) || recipes.length === 0 || recipes.length > 15 ||
      new Set(recipes.map(recipe => recipe.id)).size !== recipes.length) {
    throw new Error('Kies één tot vijftien verschillende eigen recepten.')
  }
  const lines: OwnRecipeChecklistLine[] = []
  const groups = new Map<string, OwnRecipeChecklistLine>()
  const heldRecipes: string[] = []
  for (const recipe of recipes) {
    if (!recipe || typeof recipe.title !== 'string' ||
        !Array.isArray(recipe.ingredients) || !recipe.ingredients.length) {
      throw new Error('Een eigen recept heeft geen leesbare ingrediënten.')
    }
    const ready = !!toPlannerRecipe(recipe, { usage: 'unpriced-demand' })
    if (!ready) heldRecipes.push(recipe.title)
    const single = ready
      ? ownRecipeShoppingChecklist(recipe, recipe.servings!)
      : null
    const sourceLines = single?.canCopy ? single.lines : recipe.ingredients.map((ingredient, index) => ({
      key: String(index), label: ingredient.label || ingredient.original,
      amount: null, unit: null, original: ingredient.original, needsReview: true,
    } as OwnRecipeChecklistLine))
    for (const item of sourceLines) {
      const complete = ready && !item.needsReview && item.amount !== null &&
        item.unit !== null && Number.isFinite(item.amount) && item.amount > 0
      const label = typeof item.label === 'string' ? item.label.trim() : ''
      // Mirror the canonical Planner ingredient identity, NOT a display
      // label that may be spelled the same for physically different items.
      const groupKey = complete && typeof item.query === 'string' && item.query.trim()
        ? JSON.stringify([item.query, item.unit]) : null
      const prior = groupKey ? groups.get(groupKey) : null
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
        groups.delete(groupKey!)
        continue
      }
      const line: OwnRecipeChecklistLine = {
        key: String(lines.length),
        label: label || recipe.title,
        query: groupKey ? item.query : undefined,
        amount: complete ? item.amount : null,
        unit: complete ? item.unit : null,
        needsReview: !complete,
        original: item.original,
      }
      lines.push(line)
      if (groupKey) groups.set(groupKey, line)
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
    checklist, recipes: recipes.length, heldRecipes,
    complete: !heldRecipes.length && lines.every(line => !line.needsReview),
  }
}
