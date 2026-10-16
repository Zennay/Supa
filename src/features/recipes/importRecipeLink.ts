import type { UserRecipeDraft } from '../../domain/userRecipeImport'

/** Only this explicitly user-triggered, same-origin POST crosses the UI boundary. */
export async function importRecipeLink(url: string, signal: AbortSignal): Promise<UserRecipeDraft> {
  const response = await fetch('/api/recipes/import', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }), signal,
  })
  const payload = await response.json().catch(() => { throw new Error('Linkimport is op deze versie nog niet beschikbaar. Je kunt het recept wel handmatig toevoegen.') })
  if (!response.ok) throw new Error(payload.error || 'Importeren is niet gelukt.')
  return payload.draft
}
