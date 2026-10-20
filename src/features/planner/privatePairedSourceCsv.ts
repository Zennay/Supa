import type { PrivateReviewedSourceLine } from '../comparison/privateReviewedBasketBridge.ts'
import { literalCsv } from '../../privateBasketComparisonCsv.ts'

type VerifiedPair = {
  one: PrivateReviewedSourceLine
  other: PrivateReviewedSourceLine
  difference: number
}

const columns = [
  'verantwoording', 'plus_brondatum', 'deka_brondatum',
  'ingredient_id', 'ingredient', 'benodigd', 'eenheid',
  'plus_sku', 'plus_product', 'plus_pakken', 'plus_pakprijs_cent',
  'plus_regel_cent', 'plus_eenheidsprijs',
  'deka_sku', 'deka_product', 'deka_pakken', 'deka_pakprijs_cent',
  'deka_regel_cent', 'deka_eenheidsprijs', 'verschil_deka_min_plus_cent',
] as const

/** Row-level evidence only; do NOT aggregate the rows into a whole-basket
 * shopping bill, ranking, saving or a published retailer observation. */
export function privatePairedSourceCsv(
  pairs: readonly VerifiedPair[],
  observedAt: { PLUS: string; DekaMarkt: string },
): string {
  if (!Array.isArray(pairs) || !pairs.length || pairs.length > 1000 ||
      !observedAt.PLUS || !observedAt.DekaMarkt) {
    throw new Error('Geen complete originele bronregels om te exporteren.')
  }
  const rows: (string | number)[][] = [[...columns]]
  const seen = new Set<string>()
  for (const pair of pairs) {
    const { one, other, difference } = pair
    if (!one || !other || !one.ingredientId || seen.has(one.ingredientId) ||
        one.ingredientId !== other.ingredientId ||
        one.ingredientLabel !== other.ingredientLabel ||
        !Number.isFinite(one.requiredAmount) || one.requiredAmount <= 0 ||
        one.requiredAmount !== other.requiredAmount ||
        one.requiredUnit !== other.requiredUnit ||
        !['g', 'kg', 'ml', 'l', 'piece'].includes(one.requiredUnit) ||
        !one.productId || !other.productId ||
        !Number.isSafeInteger(one.packagesNeeded) || one.packagesNeeded <= 0 ||
        !Number.isSafeInteger(other.packagesNeeded) || other.packagesNeeded <= 0 ||
        !Number.isSafeInteger(one.pricePerPackCents) || one.pricePerPackCents < 0 ||
        !Number.isSafeInteger(other.pricePerPackCents) || other.pricePerPackCents < 0 ||
        !Number.isSafeInteger(one.lineTotalCents) || one.lineTotalCents < 0 ||
        !Number.isSafeInteger(other.lineTotalCents) || other.lineTotalCents < 0 ||
        one.packagesNeeded * one.pricePerPackCents !== one.lineTotalCents ||
        other.packagesNeeded * other.pricePerPackCents !== other.lineTotalCents ||
        !Number.isSafeInteger(difference) ||
        difference !== other.lineTotalCents - one.lineTotalCents) {
      throw new Error('De bevestigde winkelregels sluiten niet; controleer originele SKU’s.')
    }
    seen.add(one.ingredientId)
    rows.push([
      'Privé voorlopige REGEL; geen volledig mandje of geverifieerde besparing',
      observedAt.PLUS, observedAt.DekaMarkt,
      one.ingredientId, one.ingredientLabel, one.requiredAmount, one.requiredUnit,
      one.productId, one.productName, one.packagesNeeded, one.pricePerPackCents,
      one.lineTotalCents, one.unitPrice ?? '',
      other.productId, other.productName, other.packagesNeeded,
      other.pricePerPackCents, other.lineTotalCents, other.unitPrice ?? '',
      difference,
    ])
  }
  const csv = '\uFEFF' + rows.map((row, index) =>
    row.map((cell, position) => literalCsv(cell,
      index > 0 && position === columns.length - 1)).join(',')).join('\r\n') + '\r\n'
  if (new TextEncoder().encode(csv).length > 256_000) {
    throw new Error('De privéregelvergelijking is te groot.')
  }
  return csv
}
