import type { PrivateCaptureProgress, PrivateReviewedBaskets } from '../comparison/privateReviewedBasketBridge.ts'
import { privateKnownPricePairs, formatKnownUnitGap, type PrivateKnownPricePair } from './privateProgressProductRows.ts'
import { selectOriginalPricePairs } from './selectOriginalPricePairs.ts'
import { euro } from '../../lib/money.ts'

/** Mobile-friendly private copy of genuinely paired original product prices.
 * A partial set can never form a whole-basket winner or savings promise.
 */
export function privateKnownLinePriceText(
  progress: PrivateCaptureProgress | null,
  reviewed: PrivateReviewedBaskets | null,
  now: number,
  renderedSelection?: readonly PrivateKnownPricePair[],
): string {
  const paired = selectOriginalPricePairs(
    privateKnownPricePairs(progress, reviewed, now), renderedSelection)
  if (!paired.length) throw Error('Er zijn geen actuele eigen prijsparen om te kopiëren.')
  const literal = (value: string) => value.replace(/[\r\n\t\u2028\u2029]/gu, ' ')
  const rows = paired.flatMap(pair => [
    literal(pair.ingredientLabel) + ' · ' + pair.plusRequiredAmount + ' ' +
      pair.plusRequiredUnit + ' (PLUS) / ' + pair.dekaRequiredAmount + ' ' +
      pair.dekaRequiredUnit + ' (DekaMarkt)',
    'PLUS · ' + literal(pair.plusProduct.productName) +
      ' · SKU ' + literal(pair.plusProduct.productId) + ' · ' +
      pair.plusPacks + ' hele pak(ken) · ' +
      pair.plusProduct.packCount + ' × ' + pair.plusProduct.packAmount + ' ' +
      pair.plusProduct.packUnit + '/pak · ' +
      euro.formatCents(pair.plusProduct.pricePerPackCents) + '/pak · ' +
      (pair.plusProduct.unitRate ?? 'eenheidsprijs onbekend') +
      ' · regel ' + euro.formatCents(pair.plusCents) +
      ' · eigen bron ' + literal(pair.plusObservedAt),
    'DekaMarkt · ' + literal(pair.dekaProduct.productName) +
      ' · SKU ' + literal(pair.dekaProduct.productId) + ' · ' +
      pair.dekaPacks + ' hele pak(ken) · ' +
      pair.dekaProduct.packCount + ' × ' + pair.dekaProduct.packAmount + ' ' +
      pair.dekaProduct.packUnit + '/pak · ' +
      euro.formatCents(pair.dekaProduct.pricePerPackCents) + '/pak · ' +
      (pair.dekaProduct.unitRate ?? 'eenheidsprijs onbekend') +
      ' · regel ' + euro.formatCents(pair.dekaCents) +
      ' · eigen bron ' + literal(pair.dekaObservedAt),
    pair.difference === 0 ? 'Voor deze ingrediëntregel gelijk.' :
      'Voor deze ingrediëntregel ' + euro.formatCents(Math.abs(pair.difference)) +
      ' lager bij ' + (pair.difference > 0 ? 'PLUS' : 'DekaMarkt') + '.',
    formatKnownUnitGap(pair.unitGap),
    '',
  ])
  const result = [
    'SUPA · Mijn persoonlijk gecontroleerde PLUS/Deka-prijzen',
    'Uitsluitend ' + paired.length + ' zichtbare geselecteerde prijsparen.',
    'Geen compleet mandtotaal, netto besparing, kassagarantie of live winkelcatalogus.',
    '',
    ...rows,
    'Ontbrekende en verlopen producten blijven onbekend. Opnieuw controleren voor aankoop.',
  ].join('\n')
  if (new TextEncoder().encode(result).length > 256000)
    throw Error('De eigen prijsselectie is te groot om veilig te kopiëren.')
  return result
}
