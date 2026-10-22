import { safeRecipeSourceUrl } from '../../domain/recipeSourceUrl.ts'
import type { UserRecipeDraft } from '../../domain/userRecipeImport.ts'
import { importRecipeLink, RecipeLinkImportUnavailableError } from './importRecipeLink.ts'
import { reviewRecipe } from './recipeLibrary.ts'

/** Accept a direct URL or a conventional Markdown list item, then apply the
 * same strict public-HTTPS source policy used by the single-link importer. */
function normalizeRecipeLinkLine(line: string, lineNumber: number): string {
  let candidate = line.trim().replace(/^(?:[-*+•]\s+|\d{1,3}[.)]\s+)/u, '').trim()
  const markdown = /^\[[^\]\r\n]{1,180}\]\((https:\/\/[^()\s]+)\)$/iu.exec(candidate)
  if (markdown) candidate = markdown[1]
  else {
    const autolink = /^<([^<>\s]+)>$/u.exec(candidate)
    if (autolink) candidate = autolink[1]
  }
  try {
    return safeRecipeSourceUrl(candidate)
  } catch {
    throw new Error(`Regel ${lineNumber}: gebruik één directe openbare HTTPS-receptlink per regel.`)
  }
}

/**
 * Import an explicitly selected small set of public recipe page URLs through
 * the EXISTING SSRF/redirect-limited same-origin recipe endpoint.
 * Accept raw URLs and conventional Markdown bullets/numbered links without
 * broad URL extraction; each non-empty line must still contain one URL only.
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
    throw new Error('Plak maximaal acht openbare HTTPS-receptlinks, één per regel; Markdown-bullets en [naam](https://…) zijn toegestaan.')
  }
  const rawUrls = text.split(/\r\n?|\n/u)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(item => item.line.length > 0)
  if (rawUrls.length < 1 || rawUrls.length > 8) {
    throw new Error('Kies één tot acht openbare receptlinks per import.')
  }
  const urls = rawUrls.map(item => normalizeRecipeLinkLine(item.line, item.lineNumber))
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
