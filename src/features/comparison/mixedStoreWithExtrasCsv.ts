import { literalCsv } from '../../privateBasketComparisonCsv.ts'
import type { OwnExtraGrocery } from './ownExtraGroceriesCsv.ts'
import type { UnpricedShoppingNote } from '../shopping-list/ManualShoppingNotes.tsx'
import { normalizePrivateNotes } from '../shopping-list/manualShoppingNotesBackup.ts'

/** Extends the already validated, personal 28-column mixed-route receipt.
 * Unpriced rows have NO retailer identity, source SKU, package price, cents
 * amount or attribution. This file is never a retailer price import. */
export function appendUnpricedExtrasToMixedRouteCsv(
  reviewedCsv: string, extras: readonly OwnExtraGrocery[],
): string {
  if (!reviewedCsv.startsWith('"soort",') || !reviewedCsv.endsWith('\r\n') ||
      extras.length === 0 || extras.length > 100)
    throw Error('Een geldige privéwinkelroute en bewaarde extras zijn vereist.')
  const rows: string[] = []
  for (const item of extras) {
    if (typeof item.id !== 'string' || typeof item.name !== 'string' ||
        !Number.isFinite(item.quantity) || item.quantity <= 0 ||
        item.quantity > 100000 || !['g', 'ml', 'piece'].includes(item.unit) ||
        (item.unit === 'piece' && !Number.isSafeInteger(item.quantity)) ||
        typeof item.done !== 'boolean') {
      throw Error('Extra boodschappen bevatten ongeldige fysieke gegevens.')
    }
    const row = Array<string>(28).fill('')
    row[0] = 'eigen_extra_ongeprijsd'
    row[1] = item.id
    row[2] = item.name
    row[3] = String(item.quantity)
    row[4] = item.unit === 'piece' ? 'stuks' : item.unit
    row[26] = item.done ? 'ja' : 'nee'
    row[27] = 'Eigen ongeprijsd; geen gekozen winkel of SKU; bedragen en verschillen sluiten deze regel uit.'
    rows.push(row.map(value => literalCsv(value)).join(','))
  }
  const result = reviewedCsv + rows.join('\r\n') + '\r\n'
  if (new TextEncoder().encode(result).length > 256000)
    throw Error('De volledige privé-CSV is te groot.')
  return result
}

/** Append personal handwritten reminders to a private 28-column route file.
 * This is a display-only row type. In particular, the 'gekozen_winkel',
 * original PLUS/Deka source, package, per-unit and money columns stay blank.
 * Never pass the result back through a retailer-source importer. */
export function appendManualUnpricedNotesToMixedRouteCsv(
  reviewedCsv: string, notes: readonly UnpricedShoppingNote[],
): string {
  if (!reviewedCsv.startsWith('"soort",') ||
      !reviewedCsv.endsWith('\r\n') ||
      !Array.isArray(notes) || notes.length > 100)
    throw Error('Gebruik alleen een bestaande gecontroleerde privéroute.')
  if (!notes.length) return reviewedCsv
  const admitted = normalizePrivateNotes({
    schema: 'supa-private-unpriced-notes-v1', notes: [...notes],
  })
  const rows = admitted.map(note => {
    const row = Array<string>(28).fill('')
    row[0] = 'eigen_notitie_ongeprijsd'
    row[1] = note.id
    row[2] = note.label
    row[26] = note.done ? 'ja' : 'nee'
    row[27] = 'Privé herinnering bij ' + note.store +
      '; geen gecontroleerde winkel, SKU, bronmoment, pakprijs, eenheidsprijs of eurobedrag.'
    return row.map(value => literalCsv(value)).join(',')
  })
  const result = reviewedCsv + rows.join('\r\n') + '\r\n'
  if (new TextEncoder().encode(result).length > 256000)
    throw Error('De gecombineerde privéwinkelroute is te groot.')
  return result
}
