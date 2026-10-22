import type { aggregatePlanIngredients } from '../../domain/basket.ts'
import type { UnpricedShoppingNote } from '../shopping-list/ManualShoppingNotes.tsx'
import { exportUnpricedShoppingCsv, importUnpricedShoppingCsv } from '../shopping-list/manualShoppingNotesCsv.ts'
import { privateNoteDuplicateKey } from '../shopping-list/manualShoppingNoteIdentity.ts'
import { serializePrivateNotes } from '../shopping-list/manualShoppingNotesBackup.ts'
import { readablePlannerDemandAmount } from './plannerPriceCaptureGuide.ts'

type Demand = ReturnType<typeof aggregatePlanIngredients>[number]
export type PersonalNoteDraft = Pick<UnpricedShoppingNote, 'label' | 'store' | 'done'>
export type PersonalNoteDestination = UnpricedShoppingNote['store'] | 'Beide winkels'
const key = (line: Demand) => JSON.stringify([line.id, line.label, line.amount, line.unit])

/** A lossless, intentionally UNPRICED private transfer proposal from the
 * currently selected physical Planner demand. Never imports example SKUs,
 * retailer identities, price fields, licenses or observation times.
 */
export function preparePlannerPersonalNotes(
  lines: readonly Demand[],
  checked: Readonly<Record<string, boolean>>,
  openOnly: boolean,
  current: readonly UnpricedShoppingNote[],
  destination: PersonalNoteDestination = 'Algemeen',
): { incoming: PersonalNoteDraft[]; skipped: number; before: string } {
  if (!Array.isArray(lines) || !Array.isArray(current) || lines.length < 1 ||
      lines.length > 2000 || !checked || typeof checked !== 'object') {
    throw Error('Geen geldige actuele Planner-week.')
  }
  if (!['Algemeen', 'PLUS', 'DekaMarkt', 'Beide winkels'].includes(destination)) throw Error('Kies een geldige persoonlijke winkellijst.')
  const before = serializePrivateNotes([...current])
  const selection = openOnly ? lines.filter(line => checked[key(line)] !== true) : lines
  if (!selection.length) throw Error('Alle geselecteerde ingrediënten zijn al afgevinkt.')
  if (selection.length > 100) throw Error('Meer dan 100 ingrediënten. Exporteer je week als CSV.')
  const destinations: UnpricedShoppingNote['store'][] = destination === 'Beide winkels'
    ? ['PLUS', 'DekaMarkt'] : [destination]
  if (selection.length * destinations.length > 100) {
    throw Error('Beide winkeloverzichten samen passen niet binnen 100 regels. Kies minder ingrediënten.')
  }
  const source: PersonalNoteDraft[] = selection.flatMap(line => {
    if (typeof line.label !== 'string' || !line.label.trim() ||
        !['g', 'kg', 'ml', 'l', 'piece', 'unknown'].includes(line.unit)) {
      throw Error('Een recept bevat een onbekend ingrediënt. Controleer het recept.')
    }
    const amount = readablePlannerDemandAmount(line.amount)
    const quantity = amount === 'hoeveelheid nog controleren'
      ? 'hoeveelheid controleren (' + line.unit + ')'
      : amount.replace('.', ',') + ' ' + (line.unit === 'piece' ? 'stuks' : line.unit)
    return destinations.map(store => ({ store, label: line.label + ' · ' + quantity,
      done: checked[key(line)] === true }))
  })
  // Existing strict personal note importer is the single schema and
  // spreadsheet-safe boundary. Nothing is saved or downloaded here.
  const csv = exportUnpricedShoppingCsv(source)
  if (new TextEncoder().encode(csv).byteLength > 32768) {
    throw Error('Deze persoonlijke import is groter dan 32 kB; download de Planner-CSV.')
  }
  const parsed = importUnpricedShoppingCsv(csv)
  const known = new Set(current.map(note => privateNoteDuplicateKey(note.store, note.label)))
  let skipped = 0
  const incoming: PersonalNoteDraft[] = []
  for (const item of parsed) {
    const identity = privateNoteDuplicateKey(item.store, item.label)
    if (known.has(identity)) { skipped++; continue }
    known.add(identity)
    incoming.push(item)
  }
  if (current.length + incoming.length > 100) {
    throw Error('De persoonlijke lijst heeft maximaal 100 regels. Er is niets toegevoegd.')
  }
  return { incoming, skipped, before }
}
