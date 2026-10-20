import { literalCsv } from '../../privateBasketComparisonCsv.ts'
import { valid, type Item } from '../comparison/ownExtraGroceriesStorage.ts'

/**
 * Extends the existing strict, complete, source-checked 18-column one-shop
 * receipt. Private user extras are separate rows with no retailer, original
 * SKU, observed time, package count, price or total. Never an import feed.
 */
export function appendUnpricedExtrasToSingleStoreCsv(
  reviewedCsv: string, extras: readonly Item[],
): string {
  if (!reviewedCsv.startsWith('"soort","winkel","opnametijd",') ||
      !reviewedCsv.endsWith('\r\n') || extras.length < 1 || extras.length > 100)
    throw Error('Een geldige eigen winkelbron en bewaarde extra artikelen zijn vereist.')
  const rows = extras.map(item => {
    if (!valid(item)) throw Error('Een eigen extra artikel is ongeldig.')
    const row = Array<string>(18).fill('')
    row[0] = 'eigen_extra_ongeprijsd'
    row[3] = item.id
    row[4] = item.name
    row[5] = String(item.quantity)
    row[6] = item.unit === 'piece' ? 'stuks' : item.unit
    row[16] = item.done ? 'ja' : 'nee'
    row[17] = 'Eigen extra zonder winkel, SKU of bronprijs. Niet in mandtotaal of besparing.'
    return row.map(value => literalCsv(value)).join(',')
  })
  const csv = reviewedCsv + rows.join('\r\n') + '\r\n'
  if (new TextEncoder().encode(csv).length > 256000)
    throw Error('Complete boodschappenlijst is te groot voor CSV.')
  return csv
}
