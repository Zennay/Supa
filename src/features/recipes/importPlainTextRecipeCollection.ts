import type { UserRecipeDraft } from '../../domain/userRecipeImport.ts'
import { importPlainTextRecipe } from './importPlainTextRecipe.ts'
import { reviewRecipe } from './recipeLibrary.ts'

/**
 * Offline collection of personally supplied Markdown recipes, separated by
 * a line containing only "---". Do not fetch URLs or treat recipe ingredients
 * as retailer product / price evidence.
 */
export function importPlainTextRecipeCollection(raw: string): UserRecipeDraft[] {
  if (typeof raw !== 'string' || !raw.trim() ||
      new TextEncoder().encode(raw).length > 500_000) {
    throw new Error('Kies een lokaal receptenbestand van maximaal 500 kB.')
  }
  const parts = raw.replace(/\r\n?/gu, '\n').split(/^---[ \t]*$/gmu)
  if (parts.length < 2) {
    throw new Error('Gebruik voor meerdere recepten een aparte regel met --- tussen elk recept.')
  }
  if (parts.length > 15 || parts.some(part => !part.trim())) {
    throw new Error('Importeer maximaal 15 volledige recepten. Laat geen lege recepten tussen de scheidingsregels.')
  }
  // Reject the entire collection when any section is malformed. This must
  // never partially save a book where a recipe's quantity was misread.
  return parts.map((part, index) => {
    try {
      return reviewRecipe(importPlainTextRecipe(part))
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : 'onleesbaar recept'
      throw new Error('Recept ' + (index + 1) + ': ' + reason)
    }
  })
}
