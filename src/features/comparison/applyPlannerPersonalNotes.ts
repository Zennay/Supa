import type { UnpricedShoppingNote } from '../shopping-list/ManualShoppingNotes.tsx'
import { exportUnpricedShoppingCsv, importUnpricedShoppingCsv } from '../shopping-list/manualShoppingNotesCsv.ts'
import { privateNoteDuplicateKey } from '../shopping-list/manualShoppingNoteIdentity.ts'
import { serializePrivateNotes, PRIVATE_NOTES_BACKUP_MAX_BYTES } from '../shopping-list/manualShoppingNotesBackup.ts'
import type { PersonalNoteDraft } from './plannerPersonalNotes.ts'

/** One all-or-none insertion into the existing user-owned, unpriced notes.
 * Never changes existing IDs/ticks, priced baskets or retailer evidence.
 */
export function applyPlannerPersonalNotes(
  current: readonly UnpricedShoppingNote[],
  incoming: readonly PersonalNoteDraft[],
  expectedExisting: string,
): { notes: UnpricedShoppingNote[]; added: number } {
  if (!Array.isArray(current) || !Array.isArray(incoming) ||
      incoming.length < 1 || incoming.length > 100 ||
      serializePrivateNotes([...current]) !== expectedExisting) {
    throw Error('De eigen boodschappen zijn veranderd. Herbekijk je Planner-overdracht.')
  }
  const allowed = importUnpricedShoppingCsv(exportUnpricedShoppingCsv(incoming))
  if (allowed.length !== incoming.length || allowed.some(item => !['Algemeen', 'PLUS', 'DekaMarkt'].includes(item.store))) {
    throw Error('Alleen geldig beoordeelde ongeprijsde Planner-ingrediënten mogen worden overgenomen.')
  }
  const seen = new Set(current.map(note => privateNoteDuplicateKey(note.store, note.label)))
  const additions: UnpricedShoppingNote[] = []
  for (const item of allowed) {
    const identity = privateNoteDuplicateKey(item.store, item.label)
    if (seen.has(identity)) continue
    seen.add(identity)
    additions.push({ ...item, id: 'own-note-' + crypto.randomUUID() })
  }
  if (current.length + additions.length > 100) {
    throw Error('Te weinig ruimte voor je Planner-week (maximaal 100 eigen artikelen).')
  }
  const result = [...current, ...additions]
  if (new TextEncoder().encode(serializePrivateNotes(result)).byteLength > PRIVATE_NOTES_BACKUP_MAX_BYTES) {
    throw Error('De complete privéboodschappenbackup zou te groot worden.')
  }
  return { notes: result, added: additions.length }
}
