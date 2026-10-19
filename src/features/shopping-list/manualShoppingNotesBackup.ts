import type { UnpricedShoppingNote } from './ManualShoppingNotes.tsx'

export const PRIVATE_NOTES_BACKUP_MAX_BYTES = 65536
const MAX_NOTES = 100
const stores = new Set(['Algemeen', 'PLUS', 'DekaMarkt'])
const safeText = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ')
  .replace(/\s+/gu, ' ').trim()

/** A portable *user-owned* unpriced list, never a source of prices or retailer data. */
export function serializePrivateNotes(notes: UnpricedShoppingNote[]): string {
  const valid = normalizePrivateNotes({ schema: 'supa-private-unpriced-notes-v1', notes })
  return JSON.stringify({ schema: 'supa-private-unpriced-notes-v1', notes: valid }, null, 2) + '\n'
}

export function normalizePrivateNotes(input: unknown): UnpricedShoppingNote[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Geen geldige privéboodschappenbackup.')
  }
  const record = input as Record<string, unknown>
  if (Object.keys(record).sort().join(',') !== 'notes,schema' ||
      record.schema !== 'supa-private-unpriced-notes-v1' ||
      !Array.isArray(record.notes) || record.notes.length > MAX_NOTES) {
    throw new Error('Onbekende versie of te veel boodschappen (maximaal 100).')
  }
  const ids = new Set<string>()
  return record.notes.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Een boodschappenregel is ongeldig.')
    }
    const note = value as Record<string, unknown>
    if (Object.keys(note).sort().join(',') !== 'done,id,label,store' ||
        typeof note.id !== 'string' || !/^own-note-[a-f0-9-]{36}$/iu.test(note.id) ||
        ids.has(note.id) ||
        typeof note.label !== 'string' || note.label.length < 1 ||
        note.label.length > 140 || safeText(note.label) !== note.label ||
        typeof note.store !== 'string' || !stores.has(note.store) ||
        typeof note.done !== 'boolean') {
      throw new Error('De backup bevat ongeldige of dubbele boodschappen.')
    }
    ids.add(note.id)
    return { id: note.id, label: note.label, store: note.store as UnpricedShoppingNote['store'], done: note.done }
  })
}

export function mergePrivateNotes(current: UnpricedShoppingNote[], incoming: UnpricedShoppingNote[]) {
  if (!Array.isArray(current) || !Array.isArray(incoming)) throw new Error('Geen geldige boodschappen.')
  const existing = new Map(current.map(item => [item.id, item]))
  const additional: UnpricedShoppingNote[] = []
  for (const note of incoming) {
    const found = existing.get(note.id)
    if (found) {
      if (found.label !== note.label || found.store !== note.store || found.done !== note.done) {
        throw new Error('Een bestaande boodschap heeft hetzelfde ID maar andere inhoud; niets is geïmporteerd.')
      }
    } else {
      additional.push(note)
      existing.set(note.id, note)
    }
  }
  if (existing.size > MAX_NOTES) throw new Error('De samengevoegde lijst zou meer dan 100 artikelen bevatten.')
  return { notes: [...current, ...additional], added: additional.length }
}
