import { literalCsv } from '../../privateBasketComparisonCsv.ts'
import type { OwnExtraGrocery } from './ownExtraGroceriesCsv.ts'

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
