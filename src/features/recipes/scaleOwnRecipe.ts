import { createManualRecipeDraft, type UserRecipeDraft } from '../../domain/userRecipeImport.ts'
import type { SavedRecipe } from './recipeLibrary.ts'
import { toPlannerRecipe } from './plannerRecipes.ts'
import { scaledMetricPortionAmount } from '../../domain/metricPortionScale.ts'

/**
 * Explicitly create a new, unpriced recipe variant. Never mutate the original
 * recipe or silently round a fractional egg, onion or another physical piece.
 * Gram/ml demand rounds UP at the third decimal rather than underbuying.
 */
export function scaleOwnRecipe(recipe: SavedRecipe, portions: number): UserRecipeDraft {
  if (!Number.isSafeInteger(portions) || portions < 1 || portions > 100) {
    throw new Error('Kies een heel aantal van 1 t/m 100 porties.')
  }
  if (!toPlannerRecipe(recipe) || !Number.isFinite(recipe.servings) || recipe.servings === null) {
    throw new Error('Controleer eerst de originele metrische hoeveelheden van dit recept.')
  }
  if (recipe.servings === portions) {
    throw new Error('Dit recept heeft al dat aantal porties. Gebruik het origineel in Planner.')
  }
  const lines = recipe.ingredients.map(ingredient => {
    const unit = ingredient.unit
    const rounded = unit
      ? scaledMetricPortionAmount(ingredient.amount!, recipe.servings!, portions, unit)
      : null
    if (rounded === null) {
      throw new Error('Eén of meer ingrediënten bevatten onveilige portiehoeveelheden of gedeeltelijke stuks. Maak hiervoor handmatig een variant.')
    }
    return String(rounded).replace('.', ',') + ' ' + (unit === 'piece' ? 'stuks' : unit) + ' ' + ingredient.label
  })
  const suffix = ' (' + portions + ' porties)'
  const title = recipe.title.slice(0, 160 - suffix.length) + suffix
  const draft = createManualRecipeDraft({
    title, servings: portions, minutes: recipe.minutes, ingredients: lines, steps: recipe.steps,
  })
  if (!toPlannerRecipe({
    ...draft, id: recipe.id, savedAt: recipe.savedAt,
  })) {
    throw new Error('De nieuwe hoeveelheden zijn niet veilig te plannen. Maak een handmatige variant.')
  }
  return draft
}

/** getRandomValues also works on HTTP/IP browser sessions where randomUUID is unavailable. */
export function ownRecipeId(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Veilige lokale recept-ID kan niet worden gemaakt op dit apparaat.')
  }
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return 'own-' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}
