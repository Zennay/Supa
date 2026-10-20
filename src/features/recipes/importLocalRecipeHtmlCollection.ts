import { importLocalJsonLdRecipeCollection } from './importLocalJsonLdRecipeCollection.ts'
import type { UserRecipeDraft } from '../../domain/userRecipeImport.ts'

/**
 * Read recipe JSON-LD from a locally saved HTML page WITHOUT mounting,
 * rendering, executing scripts, loading assets or making HTTP requests.
 * The page is not evidence of a supermarket price or a licensed feed.
 * Every Recipe candidate still goes through the existing review pipeline.
 */
export function importLocalRecipeHtmlCollection(raw: string): UserRecipeDraft[] {
  if (typeof raw !== 'string' || !raw.trim() ||
      new TextEncoder().encode(raw).length > 500_000) {
    throw new Error('Gebruik een lokaal HTML-receptbestand van maximaal 500 kB.')
  }
  const scripts: unknown[] = []
  // Match only script text; never instantiate a DOM, iframe or script element.
  // A genuine JSON-LD script cannot contain an unescaped </script> delimiter.
  const tags = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu
  let match: RegExpExecArray | null
  let seen = 0
  while ((match = tags.exec(raw)) !== null) {
    if (++seen > 80) throw new Error('Te veel scripts in deze HTML-bron.')
    const attrs = match[1]
    const type = /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(attrs)
    if (!type || (type[1] ?? type[2] ?? type[3]).trim().toLowerCase() !== 'application/ld+json') continue
    const body = match[2].trim()
    if (!body) continue
    try { scripts.push(JSON.parse(body.replace(/^\uFEFF/u, ''))) }
    catch {
      // An unrelated malformed metadata block is not a trustworthy recipe.
      // Refuse rather than silently importing a potentially partial page.
      throw new Error('De lokale HTML bevat ongeldige JSON-LD. Controleer het bronbestand.')
    }
  }
  if (!scripts.length) {
    throw new Error('Deze HTML bevat geen ingesloten schema.org Recipe JSON-LD. Gebruik anders de gewone tekstimport.')
  }
  const normalized = JSON.stringify(scripts)
  if (new TextEncoder().encode(normalized).length > 500_000) {
    throw new Error('De ingesloten receptgegevens zijn groter dan 500 kB.')
  }
  return importLocalJsonLdRecipeCollection(normalized)
}
