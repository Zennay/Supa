import type { OfflineStoreProduct } from '../../domain/offlineReviewedImport.ts'
import { privatePackUnitRate } from '../comparison/privateUnitPrice.ts'

/** Read-only classification of an original personal capture row.
 * This does NOT authorize a retailer or prove a current store price. */
export function completeOwnSourceProduct(product: OfflineStoreProduct): boolean {
  if (product.sourceAvailable !== true ||
      typeof product.sourcePriceCents !== 'number' ||
      !Number.isSafeInteger(product.sourcePriceCents) || product.sourcePriceCents < 0 ||
      product.packAmount === null || product.packAmount <= 0 ||
      product.packUnit === 'unknown' ||
      !Number.isSafeInteger(product.packCount ?? 1) || (product.packCount ?? 1) <= 0)
    return false
  return privatePackUnitRate({
    amount: product.packAmount, unit: product.packUnit,
    count: product.packCount ?? 1, priceCents: product.sourcePriceCents,
  }) !== null
}

/** A physical field to-do list, NEVER a reusable price observation.
 * A stale original capture requires an actual new observation of every row. */
export function privateSourceReviewChecklist(input: {
  store: 'PLUS' | 'DekaMarkt'
  observedAt: string
  products: readonly OfflineStoreProduct[]
  stale: boolean
}): string {
  const { store, observedAt, products, stale } = input
  if ((store !== 'PLUS' && store !== 'DekaMarkt') ||
      typeof observedAt !== 'string' || !observedAt ||
      !Array.isArray(products) || !products.length || products.length > 2000)
    throw new Error('Geen geldige oorspronkelijke winkelartikelen om mee te nemen.')
  // Plain text must not let untrusted product labels manufacture lines, fake
  // headings or control sequences. Preserve source SKU meaning; never emit prices.
  const label = (value: string) => value.replace(/[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]/gu, ' ')
    .replace(/\\s+/gu, ' ').trim().slice(0, 180)
  const lines = [
    'SUPA · privé broncontrole · ' + store,
    'Oorspronkelijke opname: ' + label(observedAt),
    stale ? 'BRON VERLOPEN: alle hieronder genoemde producten echt opnieuw opnemen.' :
      'Alleen persoonlijke zoek- en broncontrole-acties, geen goedgekeurde producten.',
    'Geen actuele prijzen, nieuwe observatietijd, retailerlicentie of besparingsclaim.',
    '',
  ]
  const seen = new Set<string>()
  for (const product of products) {
    if (!product || typeof product.id !== 'string' ||
        typeof product.name !== 'string' || !product.id.trim() || seen.has(product.id))
      throw new Error('Een originele bron-SKU is ongeldig of dubbel opgenomen.')
    seen.add(product.id)
    const reasons: string[] = []
    if (!product.sourceAvailable) reasons.push('beschikbaarheid opnieuw vaststellen')
    if (product.packAmount === null || product.packAmount <= 0 ||
        product.packUnit === 'unknown' ||
        !Number.isSafeInteger(product.packCount ?? 1) || (product.packCount ?? 1) <= 0)
      reasons.push('echte verpakking en maateenheid controleren')
    if (typeof product.sourcePriceCents !== 'number' ||
        !Number.isSafeInteger(product.sourcePriceCents) || product.sourcePriceCents < 0)
      reasons.push('werkelijke pakprijs vastleggen')
    if (stale) reasons.push('nieuw oorspronkelijk winkelmoment nodig')
    if (!reasons.length) continue
    lines.push('- ' + label(product.name) + ' · SKU ' + label(product.id),
      '  ' + reasons.join('; '))
  }
  if (lines.length === 5) throw new Error('Geen ontbrekende of verlopen originele broncontroles.')
  lines.push('', 'Leg alleen echt waargenomen producten/prijzen vast in een NIEUWE bronopname.',
    'Importeer daarna via de bestaande Supa broncontrole en kies de SKU zelf.')
  const text = lines.join('\\n') + '\\n'
  if (new TextEncoder().encode(text).length > 120_000)
    throw new Error('De broncontrolelijst is te groot. Verklein de selectie.')
  return text
}
