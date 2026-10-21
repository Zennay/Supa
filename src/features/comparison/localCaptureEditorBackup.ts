/** Inert, user-downloaded backup of partial phone capture edits.
 * Never a retailer source, accepted price, permission or product match.
 */
export type LocalCaptureEntry = {
  state: 'unseen' | 'available' | 'unavailable' | 'reuse'
  sku: string; name: string; amount: string; unit: string
  count: string; cents: string
}
export type LocalCaptureDraft = {
  rows: Record<string, LocalCaptureEntry>
  moments: Record<string, string>
}
const stores = ['PLUS', 'DekaMarkt'] as const
const states = ['unseen', 'available', 'unavailable', 'reuse'] as const
const maxBytes = 256000
const fieldLengths = { sku: 100, name: 160, amount: 64, unit: 8,
  count: 12, cents: 16 } as const
const ownRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype
const reject = (message: string): never => {
  throw new Error('Lokaal opnameconcept niet hersteld: ' + message)
}

/** No server, localStorage, or observation timestamp is created. */
export function exportLocalCaptureDraft(fingerprint: string,
  draft: LocalCaptureDraft): string {
  const text = JSON.stringify({ schema: 'supa-private-capture-editor-draft-v1',
    fingerprint, rows: draft.rows, moments: draft.moments })
  if (new TextEncoder().encode(text).byteLength > maxBytes)
    throw new Error('Concept groter dan 256 kB; bewaar de originele bron apart.')
  return text
}

/** Strict current-week restore; a snapshot from another week never overwrites edits. */
export function restoreLocalCaptureDraft(raw: string, fingerprint: string,
  selectedStores: readonly string[], count: number): LocalCaptureDraft {
  if (typeof raw !== 'string' ||
      new TextEncoder().encode(raw).byteLength > maxBytes)
    return reject('bestand is geen geldig JSON-concept tot 256 kB.')
  let decoded: unknown
  try { decoded = JSON.parse(raw) }
  catch { return reject('ongeldige JSON.') }
  if (!ownRecord(decoded) ||
      decoded.schema !== 'supa-private-capture-editor-draft-v1' ||
      decoded.fingerprint !== fingerprint ||
      !ownRecord(decoded.rows) || !ownRecord(decoded.moments)) {
    return reject('schema of geselecteerd Planner-weekmenu/winkels wijken af.')
  }
  const moments: Record<string, string> = Object.create(null)
  const rows: Record<string, LocalCaptureEntry> = Object.create(null)
  if (Object.keys(decoded.moments).length > stores.length ||
      Object.keys(decoded.rows).length > selectedStores.length * count) {
    return reject('meer regels of winkels dan het actuele menu.')
  }
  for (const [store, rawMoment] of Object.entries(decoded.moments)) {
    if (!stores.includes(store as typeof stores[number]) ||
        !selectedStores.includes(store) ||
        typeof rawMoment !== 'string' || rawMoment.length > 40)
      return reject('een onbekend winkelmoment.')
    moments[store] = rawMoment
  }
  for (const [key, value] of Object.entries(decoded.rows)) {
    const match = /^(PLUS|DekaMarkt):(0|[1-9]\d*)$/u.exec(key)
    if (!match || !selectedStores.includes(match[1]) ||
        Number(match[2]) >= count || !ownRecord(value) ||
        !states.includes(value.state as typeof states[number]) ||
        Object.keys(value).length !== 7) {
      return reject('onbekende bronregel of waarnemingsstatus.')
    }
    for (const [field, max] of Object.entries(fieldLengths)) {
      if (typeof value[field] !== 'string' ||
          (value[field] as string).length > max)
        return reject('ongeldig bronconceptveld: ' + field + '.')
    }
    // A dismissed or unavailable observation cannot carry a hidden old price
    // that silently reappears when somebody changes its status on the phone.
    if (value.state === 'unseen' &&
        ['sku', 'name', 'amount', 'unit', 'count', 'cents'].some(
          field => !!(value[field] as string).trim())) {
      return reject('niet-waargenomen regel bewaart oude brongegevens.')
    }
    if (value.state === 'unavailable' &&
        ['amount', 'count', 'cents'].some(field => !!(value[field] as string).trim())) {
      return reject('niet-beschikbaar product bewaart een oude pakprijs.')
    }
    if (value.state === 'reuse' &&
        ['name', 'amount', 'unit', 'count', 'cents'].some(
          field => !!(value[field] as string).trim())) {
      return reject('verwijzing naar eerder bronartikel bevat verborgen product- of prijsvelden.')
    }
    rows[key] = {
      state: value.state as LocalCaptureEntry['state'],
      sku: value.sku as string, name: value.name as string,
      amount: value.amount as string, unit: value.unit as string,
      count: value.count as string, cents: value.cents as string,
    }
  }
  return { rows, moments }
}
