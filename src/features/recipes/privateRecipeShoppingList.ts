import type { SavedRecipe } from './recipeLibrary.ts'
import { preparePortionCopy } from './recipePortionCopy.ts'

/** A readable local checklist, never an offer, matched store basket or
 * estimate. Reuse the same metric scaler as the human-reviewed recipe editor. */
export function privateRecipeShoppingText(recipe: SavedRecipe, servings: number): string {
  const { lines, reviews } = preparePortionCopy(recipe, servings)
  if (lines.length < 1 || lines.length > 100) throw new Error('Dit recept heeft geen geldige ingrediëntenlijst.')
  const scrub = (value: string) => value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ')
    .replace(/\s+/gu, ' ').trim().slice(0, 400)
  const reviewed = new Map(reviews.map(row => [row.index, row.reason]))
  const output = [
    'SUPA · PRIVÉ BOODSCHAPPENLIJST ZONDER WINKELPRIJZEN',
    'Recept: ' + scrub(recipe.title),
    'Porties: ' + servings,
    'Geen winkelproductmatch, voorraadindicatie, prijs of besparingsclaim.',
    '',
    ...lines.map((line, index) => {
      const warning = reviewed.get(index)
      return '☐ ' + scrub(line) + (warning
        ? '\n   MAAT NOG CONTROLEREN: ' + scrub(warning) : '')
    }),
    '',
    reviews.length > 0
      ? reviews.length + ' ingrediënten met onzekere maten. Controleer deze voor boodschappen.'
      : 'Alle hoeveelheden komen uit jouw gecontroleerde recept.',
    'Neem werkelijke productbeschikbaarheid en benodigde verpakkingen zelf door.',
    '',
  ].join('\n')
  if (new TextEncoder().encode(output).byteLength > 100_000) {
    throw new Error('Deze privéboodschappenlijst is te groot.')
  }
  return output
}
