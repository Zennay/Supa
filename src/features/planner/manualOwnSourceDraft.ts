export type ManualStore = 'PLUS' | 'DekaMarkt'
export type ManualField =
  | 'id' | 'name' | 'packAmount' | 'packUnit' | 'packCount' | 'priceCents' | 'available'
export type ManualEntry = Record<ManualField, string> & {
  // Optional Planner checklist hint. Not an original retailer fact or product.
  needHint?: { id: string; label: string; quantity: string }
}
export type ManualSource = { observedAt: string; products: ManualEntry[] }
export type ManualSources = Record<ManualStore, ManualSource>

export const MANUAL_DRAFT_MAX_BYTES = 64000
const FIELDS: readonly ManualField[] = [
  'id', 'name', 'packAmount', 'packUnit', 'packCount', 'priceCents', 'available',
]
const LIMITS: Record<ManualField, number> = {
  id: 100, name: 160, packAmount: 20, packUnit: 10,
  packCount: 5, priceCents: 7, available: 5,
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** A draft is only editable input, never an admitted retailer capture. */
export function exportManualOwnSourceDraft(sources: ManualSources): string {
  const text = JSON.stringify({ schema: 'supa-manual-source-draft-v2', sources }, null, 2) + '\n'
  if (new TextEncoder().encode(text).length > MANUAL_DRAFT_MAX_BYTES)
    throw new Error('Het concept is te groot voor een veilig lokaal bestand.')
  return text
}

/** Only known string fields enter form state. No timestamps, rights or
 * valid-price status are derived from a restored draft. */
export function importManualOwnSourceDraft(raw: string): ManualSources {
  if (new TextEncoder().encode(raw).length > MANUAL_DRAFT_MAX_BYTES)
    throw new Error('Conceptbestand is groter dan 64 kB.')
  let parsed: unknown
  try { parsed = JSON.parse(raw) }
  catch { throw new Error('Conceptbestand is geen geldige JSON.') }
  if (!isRecord(parsed) ||
      !['supa-manual-source-draft-v1', 'supa-manual-source-draft-v2'].includes(parsed.schema as string) ||
      !isRecord(parsed.sources))
    throw new Error('Onbekende conceptversie. Open een eerder Supa-invulconcept.')
  const result = {} as ManualSources
  for (const store of ['PLUS', 'DekaMarkt'] as const) {
    const source = parsed.sources[store]
    if (!isRecord(source) || typeof source.observedAt !== 'string' ||
        source.observedAt.length > 40 || !Array.isArray(source.products) ||
        source.products.length > 30)
      throw new Error(store + ': bronmoment of artikellijst is ongeldig.')
    const products: ManualEntry[] = []
    for (const row of source.products as unknown[]) {
      if (!isRecord(row)) throw new Error(store + ': ongeldig conceptartikel.')
      const entry = {} as ManualEntry
      for (const field of FIELDS) {
        const value = row[field]
        if (typeof value !== 'string' || value.length > LIMITS[field])
          throw new Error(store + ': ongeldig of te lang ' + field + '-veld.')
        entry[field] = value
      }
      if (parsed.schema === 'supa-manual-source-draft-v2' && row.needHint !== undefined) {
        if (!isRecord(row.needHint) || typeof row.needHint.id !== 'string' ||
            row.needHint.id.length > 140 || typeof row.needHint.label !== 'string' ||
            row.needHint.label.length > 180 || typeof row.needHint.quantity !== 'string' ||
            row.needHint.quantity.length > 80)
          throw new Error(store + ': ongeldige Planner-geheugensteun in concept.')
        entry.needHint = {
          id: row.needHint.id, label: row.needHint.label, quantity: row.needHint.quantity,
        }
      }
      products.push(entry)
    }
    result[store] = { observedAt: source.observedAt, products }
  }
  return result
}
