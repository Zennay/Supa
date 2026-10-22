import { literalCsv } from '../../privateBasketComparisonCsv.ts'
import type { PrivateCaptureProgress, PrivateReviewedBaskets } from '../comparison/privateReviewedBasketBridge.ts'
import { privateKnownPricePairs, privateProgressProductRows } from './privateProgressProductRows.ts'

const headers = [
  'soort', 'ingredient_id', 'ingredient', 'fysieke_hoeveelheid', 'eenheid',
  'PLUS_originele_opnametijd', 'PLUS_SKU', 'PLUS_productnaam', 'PLUS_pakinhoud',
  'PLUS_pakeenheid', 'PLUS_stuks_per_pak', 'PLUS_pakprijs_cent', 'PLUS_eenheidsprijs',
  'PLUS_hele_verpakkingen', 'PLUS_regelprijs_cent',
  'DekaMarkt_originele_opnametijd', 'DekaMarkt_SKU', 'DekaMarkt_productnaam',
  'DekaMarkt_pakinhoud', 'DekaMarkt_pakeenheid', 'DekaMarkt_stuks_per_pak',
  'DekaMarkt_pakprijs_cent', 'DekaMarkt_eenheidsprijs', 'DekaMarkt_hele_verpakkingen',
  'DekaMarkt_regelprijs_cent', 'regelverschil_cent', 'goedkoper_bij',
  'vergelijkbare_eenheid', 'eenheidsverschil_cent', 'eenheidsprijs_lager_bij',
  'PLUS_originele_vraag', 'PLUS_vraageenheid', 'DekaMarkt_originele_vraag',
  'DekaMarkt_vraageenheid', 'geldigheid',
]

/** Private, non-importable, per-ingredient export. A missing basket never
 * becomes a fabricated full receipt, zero price or public savings claim.
 * Both source admissibility and the exact original clocks are recomputed at
 * the moment the user requests this local download.
 */
export function privateKnownLinePriceCsv(
  progress: PrivateCaptureProgress | null,
  reviewed: PrivateReviewedBaskets | null,
  now: number,
): string {
  const pairs = privateKnownPricePairs(progress, reviewed, now)
  const needs = new Map(privateProgressProductRows(progress, now).map(row =>
    [row.line.ingredientId, row.line]))
  if (pairs.length === 0) throw Error('Er zijn nog geen twee actuele, per ingrediënt vergelijkbare winkelprijzen.')
  const rows = pairs.map(pair => {
    const need = needs.get(pair.ingredientId)
    if (!need || !Number.isSafeInteger(pair.difference))
      throw Error('De originele fysieke ingrediëntvraag is veranderd; download geweigerd.')
    return [
      'alleen_ingredient', pair.ingredientId, need.ingredientLabel,
      String(need.requiredAmount), need.requiredUnit,
      pair.plusObservedAt, pair.plusProduct.productId, pair.plusProduct.productName,
      String(pair.plusProduct.packAmount), pair.plusProduct.packUnit,
      String(pair.plusProduct.packCount), String(pair.plusProduct.pricePerPackCents),
      pair.plusProduct.unitRate ?? 'onbekend', String(pair.plusPacks), String(pair.plusCents),
      pair.dekaObservedAt, pair.dekaProduct.productId, pair.dekaProduct.productName,
      String(pair.dekaProduct.packAmount), pair.dekaProduct.packUnit,
      String(pair.dekaProduct.packCount), String(pair.dekaProduct.pricePerPackCents),
      pair.dekaProduct.unitRate ?? 'onbekend', String(pair.dekaPacks), String(pair.dekaCents),
      String(Math.abs(pair.difference)), pair.difference === 0 ? 'gelijk' :
        pair.difference > 0 ? 'PLUS' : 'DekaMarkt',
      pair.unitGap?.unit ?? '', pair.unitGap ? String(pair.unitGap.roundedDifferenceCents) : '',
      pair.unitGap?.cheaper ?? (pair.unitGap ? 'gelijk' : 'onbekend'),
      String(pair.plusRequiredAmount), pair.plusRequiredUnit,
      String(pair.dekaRequiredAmount), pair.dekaRequiredUnit,
      'Eigen oorspronkelijk gecontroleerde bronregels; binnen 24 uur; eenheidsprijzen zijn indicatief; geen compleet winkelmandje, kassagarantie of onafhankelijke besparingsclaim.',
    ]
  })
  const csv = [headers, ...rows].map(row => row.map(value => literalCsv(value)).join(','))
    .join('\r\n') + '\r\n'
  if (new TextEncoder().encode(csv).length > 256_000)
    throw Error('De persoonlijke regelprijsvergelijking is te groot voor een veilig CSV-bestand.')
  return '\uFEFF' + csv
}

/** User-activated local file save. Never sends proprietary source details to
 * a network, browser-share recipient or public retailer endpoint. */
export function downloadPrivateKnownLinePriceCsv(
  progress: PrivateCaptureProgress | null,
  reviewed: PrivateReviewedBaskets | null,
): number {
  const text = privateKnownLinePriceCsv(progress, reviewed, Date.now())
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = 'supa-eigen-vergelijkbare-ingredientprijzen.csv'
    document.body.append(link)
    try { link.click() } finally { link.remove() }
  } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
  return text.split('\r\n').length - 2
}
