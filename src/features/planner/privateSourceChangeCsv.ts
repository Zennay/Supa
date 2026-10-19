import { literalCsv } from '../../privateBasketComparisonCsv.ts'
import type { CaptureRefreshChanges } from './combineOwnSourceCapture.ts'

/**
 * A derived, private SKU-review checklist, NOT a retailer source or a report
 * proving current prices. The original source timestamps remain literal.
 */
export function privateSourceChangeCsv(
  store: 'PLUS' | 'DekaMarkt', changes: CaptureRefreshChanges,
): string {
  if (!changes || !Array.isArray(changes.affectedProducts) ||
      changes.affectedProducts.length === 0 ||
      changes.affectedProducts.length > 2000 ||
      changes.affectedProducts.length !== changes.affectedTotal) {
    throw new Error('Geen volledige lijst met bronwijzigingen om te exporteren.')
  }
  const cell = (text: string) => literalCsv(text)
  const row = (fields: string[]) => fields.map(cell).join(';')
  const lines = [
    row(['Winkel', 'Originele SKU', 'Productnaam', 'Wijziging',
      'Vorig bronmoment', 'Nieuw bronmoment', 'Status']),
    ...changes.affectedProducts.map(item => row([
      store, item.sku, item.name, item.change,
      changes.previousObservedAt ?? 'Geen vorige bron',
      changes.newObservedAt,
      'Privé controle nodig; dit is geen nieuwe retailerprijsbron',
    ])),
  ]
  const output = '\uFEFF' + lines.join('\r\n') + '\r\n'
  if (new TextEncoder().encode(output).byteLength > 512_000)
    throw new Error('De privéwijzigingenlijst is te groot voor veilige spreadsheet-export.')
  return output
}
