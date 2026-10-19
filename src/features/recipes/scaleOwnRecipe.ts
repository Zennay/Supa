import { createManualRecipeDraft, type UserRecipeDraft } from '../../domain/userRecipeImport.ts'
import type { SavedRecipe } from './recipeLibrary.ts'
import { toPlannerRecipe } from './plannerRecipes.ts'

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
    const amount = ingredient.amount!
    const scaled = amount * portions / recipe.servings!
    const unit = ingredient.unit
    if (!Number.isFinite(scaled) || scaled <= 0 || scaled > 1_000_000 || !unit ||
        (unit === 'piece' && !Number.isSafeInteger(scaled))) {
      throw new Error('Eén of meer ingrediënten bevatten gedeeltelijke stuks of ongeldige hoeveelheden. Maak hiervoor handmatig een variant.')
    }
    const rounded = unit === 'piece' ? scaled : Math.ceil(scaled * 1000) / 1000
    if (!Number.isFinite(rounded) || rounded <= 0 || rounded > 1_000_000) {
      throw new Error('Een berekende hoeveelheid is te groot. Bewerk de porties handmatig.')
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
