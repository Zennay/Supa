import type { OneStoreBasket } from '../../domain/basket.ts'
import { privateSingleStoreShoppingCsv } from './privateSourceShoppingCsv.ts'
import { privateUnitPrice } from '../comparison/privateUnitPrice.ts'

const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const literal = (value: string | number) => String(value)
  .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim()

/** Private, copy-friendly one-store shopping list.
 * The canonical CSV ledger first certifies the entire physical basket.
 * No second shop, checkout proof or independently verified price is inferred.
 */
export function privateSingleStoreShoppingText({ basket, observedAt }: {
  basket: OneStoreBasket
  observedAt: string
}): string {
  privateSingleStoreShoppingCsv({ basket, observedAt, done: new Set<string>() })
  const rows = [
    'SUPA · mijn eigen ' + literal(basket.store.id) + '-weekmand',
    'Bronmoment: ' + literal(observedAt),
    'Complete pakprijzen: ' + euro.format(basket.totalCents / 100),
    'Privégegevens, niet onafhankelijk geverifieerd. Geen kassagarantie of actuele beschikbaarheid.',
    'Ontbrekende andere winkel = onbekende vergelijking, nooit € 0,00.',
    '',
  ]
  for (const line of basket.lines) {
    if (line.status !== 'matched') throw new Error('Niet alle producten zijn gecontroleerd.')
    rows.push(
      '☐ ' + literal(line.ingredientLabel) + ' · ' + literal(line.requirement.amount) +
        ' ' + literal(line.requirement.unit),
      '  ' + line.packs + ' × ' + literal(line.productName) +
        ' (SKU ' + literal(line.productId) + ')',
      '  ' + literal(line.pack.count) + ' × ' + literal(line.pack.amount) +
        ' ' + literal(line.pack.unit) + ' per pak · ' +
        euro.format(line.pricePerPackCents / 100) + ' per pak · ' +
        (privateUnitPrice(line) ?? 'eenheidsprijs onbekend'),
      '  Regelprijs hele verpakkingen: ' + euro.format(line.lineTotalCents / 100),
      '',
    )
  }
  rows.push('Alleen originele eigen bronopnames; geen geverifieerde besparing of retailerrechten.')
  const result = rows.join('\n') + '\n'
  if (new TextEncoder().encode(result).length > 256_000)
    throw new Error('De privéboodschappenlijst is te groot.')
  return result
}
