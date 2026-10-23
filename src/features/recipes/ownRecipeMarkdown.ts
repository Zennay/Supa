import type { SavedRecipe } from './recipeLibrary.ts'
import { safeRecipeSourceUrl } from '../../domain/recipeSourceUrl.ts'

/** Portable private recipe notes, deliberately without store totals or URL secrets.
 * The existing local plain-text importer remains the admission/review boundary.
 * A Markdown export is not itself a priced or approved Planner recipe. */
export function ownRecipeAsMarkdown(recipe: SavedRecipe): string {
  if (!recipe || !recipe.title?.trim() ||
      !Array.isArray(recipe.ingredients) || !recipe.ingredients.length ||
      !Array.isArray(recipe.steps) || !recipe.steps.length ||
      recipe.ingredients.length > 100 || recipe.steps.length > 100) {
    throw new Error('Dit recept is niet volledig genoeg voor een leesbare export.')
  }
  // A human-review warning is part of the recipe's meaning. Markdown is
  // intentionally a readable, lossy format and cannot retain that hold.
  // Use the complete JSON backup instead of laundering an unreviewed amount
  // into a new seemingly review-free draft on reimport.
  if (!Array.isArray(recipe.warnings) || recipe.warnings.length ||
      recipe.ingredients.some(item => item.reviewReason)) {
    throw new Error('Dit recept heeft openstaande bron- of hoeveelheidscontroles. Gebruik de volledige JSON-back-up om de waarschuwingen te behouden.')
  }
  // A single explicit Bron: header is part of our plain-text recipe format.
  // Keep only the same sanitized public attribution used by recipe storage.
  if (!['manual', 'url'].includes(recipe.source) ||
      (recipe.source === 'url' && !recipe.sourceUrl) ||
      (recipe.source === 'manual' && recipe.sourceUrl !== null)) {
    throw new Error('De bronvermelding van dit recept is ongeldig. Gebruik de volledige JSON-back-up.')
  }
  const sourceUrl = recipe.source === 'url'
    ? safeRecipeSourceUrl(recipe.sourceUrl ?? '')
    : null
  // Newlines and invisible controls inside an imported field could otherwise
  // create new Markdown sections and an apparent extra physical ingredient.
  const line = (value: string) => {
    if (typeof value !== 'string' || !value.trim() ||
        /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) || value.length > 5000) {
      throw new Error('Een receptregel bevat verborgen tekens of ongeldige tekst; corrigeer het recept vóór export.')
    }
    return value.trim()
  }
  const lines = [
    '# Recept: ' + line(recipe.title),
    ...(recipe.servings !== null && Number.isSafeInteger(recipe.servings) && recipe.servings > 0
      ? ['Porties: ' + recipe.servings] : []),
    ...(recipe.minutes !== null && Number.isSafeInteger(recipe.minutes) && recipe.minutes > 0
      ? ['Tijd: ' + recipe.minutes + ' minuten'] : []),
    ...(sourceUrl ? ['Bron: ' + line(sourceUrl)] : []),
    '', '## Ingrediënten',
    ...recipe.ingredients.map(item => '- ' + line(item.original)),
    '', '## Bereiding',
    ...recipe.steps.map((step, index) => String(index + 1) + '. ' + line(step)),
    '',
  ]
  const markdown = lines.join('\n')
  if (new TextEncoder().encode(markdown).length > 120_000)
    throw new Error('Het recept is te groot om als tekst te delen.')
  return markdown
}
