import type { ComparedOwnLine } from './ownStoreBudgetComparison.ts'
import { literalCsv } from '../../privateBasketComparisonCsv.ts'
import { privateUnitPrice } from '../comparison/privateUnitPrice.ts'
import { privateMatchedUnitPriceGap } from '../products/privateProgressProductRows.ts'

/**
 * Spreadsheet hand-off for only the explicitly visible, personally reviewed
 * prices. The caller must freshly admit the complete original PLUS/Deka pair
 * through ownStoreWeekComparison before choosing this subset.
 *
 * No new retailer source, price, total, or savings authority lives here.
 * In particular, these filtered lines must never become a basket subtotal.
 */
export function selectedOwnPriceCsv(input: {
  lines: readonly ComparedOwnLine[]
  totalOriginalLines: number
  plusObservedAt: string
  dekaObservedAt: string
}): string {
  const { lines, totalOriginalLines, plusObservedAt, dekaObservedAt } = input
  if (!lines.length || lines.length > 1000 ||
      !Number.isSafeInteger(totalOriginalLines) || totalOriginalLines < lines.length ||
      typeof plusObservedAt !== 'string' || !plusObservedAt ||
      typeof dekaObservedAt !== 'string' || !dekaObservedAt) {
    throw new Error('Geen geldige selectie uit twee gecontroleerde winkelbronnen.')
  }
  const header = [
    'status', 'geselecteerde_regels', 'originele_regels', 'ingredient_id',
    'ingredient', 'benodigd', 'eenheid',
    'PLUS_bronmoment', 'PLUS_sku', 'PLUS_product',
    'PLUS_pak_hoeveelheid', 'PLUS_pak_eenheid', 'PLUS_multipack',
    'PLUS_hele_pakken', 'PLUS_prijs_per_pak_cent', 'PLUS_regelprijs_cent',
    'PLUS_indicatieve_eenheidsprijs',
    'DekaMarkt_bronmoment', 'DekaMarkt_sku', 'DekaMarkt_product',
    'DekaMarkt_pak_hoeveelheid', 'DekaMarkt_pak_eenheid', 'DekaMarkt_multipack',
    'DekaMarkt_hele_pakken', 'DekaMarkt_prijs_per_pak_cent',
    'DekaMarkt_regelprijs_cent', 'DekaMarkt_indicatieve_eenheidsprijs',
    'indicatief_verschil_per_eenheid', 'regelverschil_cent_Deka_minus_PLUS',
    'goedkoper_bij', 'opmerking',
  ]
  const ids = new Set<string>()
  const cells = lines.map(line => {
    if (!line || typeof line.id !== 'string' || !line.id || ids.has(line.id) ||
        line.plus.status !== 'matched' || line.deka.status !== 'matched' ||
        line.plus.id !== line.id || line.deka.id !== line.id ||
        !Number.isSafeInteger(line.deltaCents) ||
        line.deltaCents !== line.deka.lineTotalCents - line.plus.lineTotalCents) {
      throw new Error('De geselecteerde productregels komen niet overeen met de bevestigde bronnen.')
    }
    ids.add(line.id)
    const store = (original: ComparedOwnLine['plus'], observedAt: string) => [
      observedAt, original.productId, original.productName,
      original.pack.amount, original.pack.unit, original.pack.count,
      original.packs, original.pricePerPackCents, original.lineTotalCents,
      privateUnitPrice(original) ?? '',
    ]
    return [
      'persoonlijk gecontroleerde filterselectie', lines.length, totalOriginalLines,
      line.id, line.ingredientLabel,
      line.plus.requirement.amount ?? '', line.plus.requirement.unit,
      ...store(line.plus, plusObservedAt),
      ...store(line.deka, dekaObservedAt),
      privateMatchedUnitPriceGap(line.plus, line.deka),
      line.deltaCents, line.deltaCents > 0 ? 'PLUS' :
        line.deltaCents < 0 ? 'DekaMarkt' : 'gelijk',
      'Alleen productregel; geen compleet mandtotaal of onafhankelijk bewijs',
    ].map((value, index) => literalCsv(value, index === header.length - 3)).join(';')
  })
  const output = '\uFEFF' + [header.join(';'), ...cells].join('\r\n') + '\r\n'
  if (new TextEncoder().encode(output).length > 256000)
    throw new Error('De geselecteerde privéprijsregels zijn te groot voor één spreadsheet.')
  return output
}
