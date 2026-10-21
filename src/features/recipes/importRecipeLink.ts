import { safeRecipeSourceUrl } from '../../domain/recipeSourceUrl.ts'
import type { UserRecipeDraft } from '../../domain/userRecipeImport'

/** The static Pages build has no same-origin Node API; callers can offer local HTML/JSON-LD import. */
export class RecipeLinkImportUnavailableError extends Error {
  constructor() {
    super('De automatische linkimportserver is op deze website niet beschikbaar.')
    this.name = 'RecipeLinkImportUnavailableError'
  }
}

/** Only this explicitly user-triggered, same-origin POST crosses the UI boundary. */
export async function importRecipeLink(url: string, signal: AbortSignal): Promise<UserRecipeDraft> {
  // Never send copied OAuth/PKCE/session credentials to a recipe endpoint:
  // recipe attribution needs a public page address, not a login token.
  const publicUrl = safeRecipeSourceUrl(url)
  const response = await fetch('/api/recipes/import', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: publicUrl }), signal,
  })
  const payload = await response.json().catch(() => { throw new Error('Linkimport is op deze versie nog niet beschikbaar. Je kunt het recept wel handmatig toevoegen.') })
  if (!response.ok) throw new Error(payload.error || 'Importeren is niet gelukt.')
  return payload.draft
}
