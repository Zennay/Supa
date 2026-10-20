import { literalCsv } from '../../privateBasketComparisonCsv.ts'
import type { HistoricalReceiptResult, ReceiptStore } from './privateReceiptHistory.ts'

const STORES: readonly ReceiptStore[] = ['PLUS', 'DekaMarkt']
const header = [
  'herkomst', 'is_winkelbron', 'fysieke_vergelijking',
  'ingredient_id', 'ingredient', 'winkel', 'bronmoment_eerder', 'bronmoment_later',
  'productcode_eerder', 'productcode_later', 'pak_eerder', 'pak_later',
  'prijs_eerder_cent', 'prijs_later_cent', 'historisch_verschil_cent',
  'opmerking',
]

/** Spreadsheet-safe, DERIVED offline price-history worksheet.
 * Not accepted as capture CSV; no absent price is ever converted to 0.
 * Use Supa's existing Unicode/invisible-prefix formula guard for every cell.
 */
export function exportPrivateReceiptHistoryCsv(
  result: Extract<HistoricalReceiptResult, { status: 'ready' }>,
): string {
  const csvRow = (values: readonly unknown[], numericDifference = false) =>
    values.map((value, index) => literalCsv(value,
      numericDifference && index === 14)).join(';')
  const rows = [csvRow(header)]
  const captures = {
    PLUS: [result.older.plusObservedAt, result.later.plusObservedAt],
    DekaMarkt: [result.older.dekaObservedAt, result.later.dekaObservedAt],
  }
  for (const line of result.rows) {
    for (const store of STORES) {
      const old = line.old[store]
      const later = line.later[store]
      const change = line.changeCents[store]
      const pkg = (p: typeof old) =>
        p.packagesNeeded + ' x ' + p.package.count + ' x ' +
        p.package.amount + ' ' + p.package.unit
      rows.push(csvRow([
        'Eigen afgeleid privérapport — geen actueel prijsbewijs',
        'NEE',
        result.stores[store].completeBasket ? 'Volledige eigen mand' :
          'Alleen dezelfde SKU-regels',
        line.ingredientId, line.ingredient, store,
        captures[store][0], captures[store][1],
        old.sourceProductId, later.sourceProductId,
        pkg(old), pkg(later),
        change === null ? '' : old.totalWholePackagesCents,
        change === null ? '' : later.totalWholePackagesCents,
        change === null ? '' : change,
        change === null ? 'Andere SKU, pak of benodigde hoeveelheid — onbekend' :
          'Alleen identieke fysieke productkeuze; historisch privé',
      ], true))
    }
  }
  for (const excluded of result.excluded) {
    rows.push(csvRow([
      'Eigen afgeleid privérapport — geen actueel prijsbewijs', 'NEE',
      'Hele mand onbekend', '', excluded.ingredient, '', '', '', '', '',
      '', '', '', '', '', excluded.reason,
    ]))
  }
  const csv = '\uFEFF' + rows.join('\r\n') + '\r\n'
  if (new TextEncoder().encode(csv).length > 256_000) {
    throw new Error('Te veel privéregels voor CSV. Gebruik de TXT-export.')
  }
  return csv
}
