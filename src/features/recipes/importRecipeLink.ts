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
  if (publicUrl.length > 2048) {
    throw new Error('Deze openbare receptlink is te lang voor de beveiligde import (maximaal 2048 tekens).')
  }
  let response: Response
  try {
    response = await fetch('/api/recipes/import', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: publicUrl }), signal,
    })
  } catch {
    if (signal.aborted) throw new Error('De receptenimport is geannuleerd.')
    throw new RecipeLinkImportUnavailableError()
  }
  if (response.status === 404 || response.status === 405 || response.status >= 500)
    throw new RecipeLinkImportUnavailableError()
  const payload = await response.json().catch(() => { throw new RecipeLinkImportUnavailableError() })
  if (!response.ok) {
    const message = payload && typeof payload.error === 'string'
      ? payload.error.trim().slice(0, 240)
      : ''
    throw new Error(message || 'Importeren is niet gelukt. Je kunt het recept handmatig toevoegen.')
  }
  if (!payload?.draft || typeof payload.draft !== 'object' || Array.isArray(payload.draft))
    throw new Error('De linkimportserver gaf geen bruikbaar receptconcept terug. Je kunt het recept handmatig toevoegen.')
  return payload.draft
}
