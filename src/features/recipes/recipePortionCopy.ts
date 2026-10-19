import type { SavedRecipe } from './recipeLibrary.ts'

/** A user-requested new recipe draft; never changes the source recipe/Planner.
 * Metrically safe amounts scale, uncertain pieces remain review-required.
 * No prices, product matches or retailer observations are inferred. */
export function preparePortionCopy(recipe: SavedRecipe, targetServings: number): {
  lines: string[]; reviews: { original: string; reason: string; index: number }[]
} {
  if (recipe.servings === null || !Number.isSafeInteger(recipe.servings) ||
      recipe.servings < 1 || recipe.servings > 1000 ||
      !Number.isSafeInteger(targetServings) || targetServings < 1 || targetServings > 1000) {
    throw new Error('Kies 1 tot 1.000 hele porties voor een recept met een bekend aantal porties.')
  }
  const lines: string[] = []
  const reviews: { original: string; reason: string; index: number }[] = []
  for (const ingredient of recipe.ingredients) {
    let line = ingredient.original
    let review = ingredient.reviewReason
    if (!review && ingredient.amount !== null && ingredient.unit !== null) {
      const scaled = ingredient.amount * targetServings / recipe.servings
      const rounded = Math.round(scaled * 1000) / 1000
      if (Number.isFinite(scaled) && rounded > 0 && rounded <= 1_000_000 &&
          Math.abs(scaled - rounded) <= 0.00000001 &&
          (ingredient.unit !== 'piece' || Number.isSafeInteger(rounded))) {
        const unit = ingredient.unit === 'piece' ? 'stuks' : ingredient.unit
        line = `${String(rounded).replace('.', ',')} ${unit} ${ingredient.label}`
      } else {
        review = ingredient.unit === 'piece'
          ? 'Een fractie van een stuk is onzeker; pas de hele aantallen handmatig aan.'
          : 'Schaalhoeveelheid is niet exact representabel; controleer metrische invoer.'
      }
    }
    if (line.length > 400) throw new Error('Een geschaalde ingrediëntregel is te lang.')
    lines.push(line)
    if (review) reviews.push({ original: line, reason: review, index: lines.length - 1 })
  }
  return { lines, reviews }
}
