import type { BasketTraceLine, OneStoreBasket } from '../../domain/basket.ts'
// Preserve source labels while guarding spreadsheet formula prefixes, including
// hidden format characters and Unicode compatibility aliases.
function literalCsv(value: string): string {
  const lead = value.normalize('NFKC')
    .replace(/^[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Mark}]*/gu, '')
  const safe = /^[=+\-@\u2212]/u.test(lead) ? "'" + value : value
  return '"' + safe.replaceAll('"', '""') + '"'
}
import { privateUnitPrice } from './privateUnitPrice.ts'

type Matched = Extract<BasketTraceLine, { status: 'matched' }>
const columns = [
  'soort', 'winkel', 'opnametijd', 'ingredient_id', 'ingredient',
  'benodigd', 'eenheid', 'originele_sku', 'origineel_product',
  'hele_verpakkingen', 'inhoud_per_pak', 'eenheid_per_pak',
  'stuks_per_pak', 'pakprijs_cent', 'regeltotaal_cent',
  'indicatieve_eenheidsprijs', 'afgevinkt', 'toelichting',
] as const

/** Export one complete human-reviewed source basket, not an importer or a
 * permission record. The caller checks the exact source age at click time. */
export function privateSingleStoreShoppingCsv({ basket, observedAt, done }: {
  basket: OneStoreBasket
  observedAt: string
  done: ReadonlySet<string>
}): string {
  if (!['PLUS', 'DekaMarkt'].includes(basket.store.id) ||
      typeof observedAt !== 'string' || !observedAt ||
      basket.lines.length === 0 || basket.selectedMealCount <= 0 ||
      basket.matchedLineCount !== basket.lines.length ||
      basket.unresolvedLineCount !== 0 || !Number.isSafeInteger(basket.totalCents) ||
      basket.totalCents < 0) throw Error('Geen volledig gecontroleerd eigen winkelmandje.')
  const rows: string[][] = [[...columns]]
  const seen = new Set<string>()
  let total = 0
  for (const line of basket.lines) {
    if (line.status !== 'matched' || seen.has(line.id) ||
        !Number.isSafeInteger(line.packs) || line.packs <= 0 ||
        !Number.isSafeInteger(line.pricePerPackCents) || line.pricePerPackCents < 0 ||
        !Number.isSafeInteger(line.lineTotalCents) ||
        line.lineTotalCents !== line.packs * line.pricePerPackCents) {
      throw Error('Controleer de originele producten en centprijzen opnieuw.')
    }
    seen.add(line.id)
    total += line.lineTotalCents
    rows.push([
      'ingredient', basket.store.id, observedAt, line.id, line.ingredientLabel,
      String(line.requirement.amount), line.requirement.unit, line.productId, line.productName,
      String(line.packs), String(line.pack.amount), line.pack.unit, String(line.pack.count),
      String(line.pricePerPackCents), String(line.lineTotalCents),
      privateUnitPrice(line) ?? 'Onbekend', done.has(line.id) ? 'ja' : 'nee',
      'Eigen gecontroleerde winkelprijs; geen actuele kassagarantie',
    ])
  }
  if (!Number.isSafeInteger(total) || total !== basket.totalCents)
    throw Error('Het winkelmandtotaal past niet bij de originele bronregels.')
  rows.push(['volledig_mandje', basket.store.id, observedAt,
    '', '', '', '', '', '', '', '', '', '', '', String(total), '', '',
    'Geen winkelrechten of onafhankelijk besparingsbewijs'])
  if (rows.some(row => row.length !== columns.length)) throw Error('Ongeldig CSV-overzicht.')
  const result = rows.map(row => row.map(cell => literalCsv(cell)).join(',')).join('\r\n') + '\r\n'
  if (new TextEncoder().encode(result).byteLength > 256_000) throw Error('Winkelmand te groot voor CSV.')
  return result
}
