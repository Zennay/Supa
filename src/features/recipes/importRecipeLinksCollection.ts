import { safeRecipeSourceUrl } from '../../domain/recipeSourceUrl.ts'
import type { UserRecipeDraft } from '../../domain/userRecipeImport.ts'
import { importRecipeLink, RecipeLinkImportUnavailableError } from './importRecipeLink.ts'
import { reviewRecipe } from './recipeLibrary.ts'

/**
 * Import an explicitly selected small set of public recipe page URLs through
 * the EXISTING SSRF/redirect-limited same-origin recipe endpoint.
 * Never fetch retailer products, follow arbitrary HTML assets, or interpret
 * recipe prices as verified store evidence.
 *
 * The caller must show all reviewed drafts before an atomic local save.
 */
export async function importRecipeLinksCollection(
  text: string,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<UserRecipeDraft[]> {
  if (typeof text !== 'string' || !text.trim() || text.length > 32_000) {
    throw new Error('Plak maximaal acht openbare HTTPS-receptlinks, één per regel.')
  }
  const rawUrls = text.split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
  if (rawUrls.length < 1 || rawUrls.length > 8) {
    throw new Error('Kies één tot acht openbare receptlinks per import.')
  }
  const urls = rawUrls.map(safeRecipeSourceUrl)
  if (new Set(urls).size !== urls.length) {
    throw new Error('Dezelfde receptlink staat meerdere keren in deze import.')
  }
  const recipes: UserRecipeDraft[] = []
  for (const [index, url] of urls.entries()) {
    if (signal.aborted) throw new Error('De receptenimport is geannuleerd.')
    try {
      // Only this user-triggered operation crosses the existing protected API.
      // A failure keeps the complete saved library unchanged.
      const draft = await importRecipeLink(url, signal)
      if (signal.aborted) throw new Error('De receptenimport is geannuleerd.')
      recipes.push(reviewRecipe(draft))
      onProgress(index + 1, urls.length)
    } catch (cause) {
      if (signal.aborted) throw new Error('De receptenimport is geannuleerd.')
      if (cause instanceof RecipeLinkImportUnavailableError) {
        throw new Error(
          'Automatische batchimport van links is op deze statische Supa-versie niet beschikbaar. ' +
          'Er is niets opgeslagen. Sla de receptpagina lokaal op als HTML of plak de JSON-LD-broncode; ' +
          'kies daarna de HTML- of JSON-LD-import en controleer de recepten. Lokale HTML ondersteunt ' +
          'schema.org Recipe JSON-LD en, als dat ontbreekt, Recipe-microdata.',
        )
      }
      const reason = cause instanceof Error ? cause.message : 'Recept kon niet worden opgehaald.'
      throw new Error('Receptlink ' + (index + 1) + ' kon niet worden geïmporteerd: ' + reason)
    }
  }
  return recipes
}
