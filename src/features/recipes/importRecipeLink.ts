import { safeRecipeSourceUrl } from '../../domain/recipeSourceUrl.ts'
import type { UserRecipeDraft } from '../../domain/userRecipeImport'

/** Only this explicitly user-triggered, same-origin POST crosses the UI boundary. */
export async function importRecipeLink(url: string, signal: AbortSignal): Promise<UserRecipeDraft> {
  // Never send copied OAuth/PKCE/session credentials to a recipe endpoint:
  // recipe attribution needs a public page address, not a login token.
  const publicUrl = safeRecipeSourceUrl(url)
  let response: Response
  try {
    response = await fetch('/api/recipes/import', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: publicUrl }), signal,
    })
  } catch {
    if (signal.aborted) throw new Error('De receptenimport is geannuleerd.')
    throw new Error('De receptpagina kon niet worden bereikt. Controleer je verbinding of voeg het recept handmatig toe.')
  }
  const payload = await response.json().catch(() => {
    throw new Error('De receptserver leverde geen leesbaar resultaat. Je kunt het recept handmatig toevoegen.')
  })
  if (!response.ok) {
    const message = payload && typeof payload.error === 'string' ? payload.error.trim().slice(0, 240) : ''
    throw new Error(message || 'Importeren is niet gelukt. Je kunt het recept handmatig toevoegen.')
  }
  if (!payload || typeof payload !== 'object' || !('draft' in payload)) {
    throw new Error('De receptserver leverde geen bruikbaar recept op. Je kunt het recept handmatig toevoegen.')
  }
  return payload.draft as UserRecipeDraft
}
