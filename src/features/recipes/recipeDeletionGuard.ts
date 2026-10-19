/**
 * A referenced user recipe is part of the physical weekly Planner demand.
 * Never silently replace a day, orphan its checklist or reuse existing
 * privately reviewed SKU/price receipts when deleting a selected recipe.
 */
export function assertRecipeNotUsedByPlanner(
  storage: Pick<Storage, 'getItem'>,
  recipeId: string,
): void {
  let raw: string | null
  try { raw = storage.getItem('supa:planner-preferences:v2') }
  catch { throw new Error('Planner-opslag is niet toegankelijk. Verwijderen is uitgeschakeld.') }
  if (raw === null) {
    throw new Error('Open en bewaar eerst je huidige Planner-week voordat je recepten verwijdert.')
  }
  if (raw.length > 100_000) {
    throw new Error('Planner-opslag is te groot om veilig te controleren. Verwijderen geannuleerd.')
  }
  let parsed: unknown
  try { parsed = JSON.parse(raw) }
  catch { throw new Error('Planner-opslag is beschadigd. Verwijderen geannuleerd.') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Planner-opslag heeft geen herkenbare vorm. Verwijderen geannuleerd.')
  }
  const plan = (parsed as Record<string, unknown>).recipeByDay
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('Planner-selecties zijn niet veilig leesbaar. Verwijderen geannuleerd.')
  }
  if (Object.values(plan).some(value => value === recipeId)) {
    throw new Error('Dit recept is nog gekozen in de Planner. Kies daar eerst een ander recept voor iedere betreffende dag.')
  }
}
