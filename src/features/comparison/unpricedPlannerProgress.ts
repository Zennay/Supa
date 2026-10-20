/**
 * Private, unpriced Planner checklist progress. One saved record only applies
 * to exactly the same days, ingredients and physical amounts.
 * Does not contain store IDs, price observations or retailer claims.
 */
export const unpricedProgressSchema = 'supa-unpriced-planner-progress-v1'
export const unpricedProgressMaxBytes = 128_000

type ProgressFile = {
  schema: typeof unpricedProgressSchema
  demandIdentity: string
  checkedKeys: string[]
}

export function unpricedProgressStorageKey(identity: string): string {
  // Small stable per-plan tab-storage key. Collisions are harmless because
  // recovery separately verifies the full, original demand identity.
  let hash = 2166136261
  for (let i = 0; i < identity.length; i++) {
    hash ^= identity.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return 'supa:unpriced-planner-ticks:v1:' + (hash >>> 0).toString(16)
}

export function exportUnpricedProgress(
  demandIdentity: string,
  lineKeys: readonly string[],
  checked: Readonly<Record<string, boolean>>,
): string {
  const permitted = new Set(lineKeys)
  const checkedKeys = lineKeys.filter(key => permitted.has(key) && checked[key] === true)
  const result: ProgressFile = { schema: unpricedProgressSchema, demandIdentity, checkedKeys }
  const json = JSON.stringify(result, null, 2)
  if (new TextEncoder().encode(json).length > unpricedProgressMaxBytes)
    throw new Error('Deze weeklijst is te groot om veilig op te slaan.')
  return json
}

export function importUnpricedProgress(
  text: string, expectedIdentity: string, lineKeys: readonly string[],
): Record<string, boolean> {
  if (!text || new TextEncoder().encode(text).length > unpricedProgressMaxBytes)
    throw new Error('Back-up is leeg of te groot (maximum 128 kB).')
  let value: unknown
  try { value = JSON.parse(text) } catch {
    throw new Error('Dit bestand bevat geen geldige Supa-weeklijstback-up.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('Dit bestand bevat geen geldige Supa-weeklijstback-up.')
  }
  const record = value as Partial<ProgressFile>
  if (record.schema !== unpricedProgressSchema ||
      typeof record.demandIdentity !== 'string' ||
      !Array.isArray(record.checkedKeys)) {
    throw new Error('Dit bestand is geen ondersteunde Supa-weeklijstback-up.')
  }
  if (record.demandIdentity !== expectedIdentity)
    throw new Error('Deze back-up hoort bij een ander weekmenu of andere hoeveelheden. Niets hersteld.')
  const allowed = new Set(lineKeys)
  const restored: Record<string, boolean> = Object.create(null) as Record<string, boolean>
  if (record.checkedKeys.length > allowed.size)
    throw new Error('De back-up bevat meer afvinkingen dan deze boodschappenlijst.')
  for (const key of record.checkedKeys) {
    if (typeof key !== 'string' || !allowed.has(key) || restored[key])
      throw new Error('De back-up bevat onbekende of dubbele boodschappen.')
    restored[key] = true
  }
  return restored
}
