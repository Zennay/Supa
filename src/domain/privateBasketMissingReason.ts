/** Human-facing next action for one explicitly matched private SKU.
 * No source fetch, price inference or economic arithmetic.
 */
export type PrivatePriceSourceFact = {
  available: boolean
  priceCents: number | null
  packAmount: number | null
}

export function privateBasketMissingReason(
  selectedSku: string | null | undefined,
  product: PrivatePriceSourceFact | undefined,
  requiredAmount: number | null,
): string | null {
  if (selectedSku === null || selectedSku === undefined) {
    return 'Kies en bevestig het werkelijke winkelartikel voor dit ingrediënt'
  }
  if (!product) {
    return 'De gekozen SKU staat niet in de huidige eigen winkelopname; zoek en bevestig de juiste SKU opnieuw'
  }
  const missing: string[] = []
  if (requiredAmount === null) {
    missing.push('Benodigde fysieke ingrediënthoeveelheid ontbreekt: controleer het recept of weekmenu')
  }
  if (!product.available) {
    missing.push('Beschikbaarheid van dit artikel is niet bevestigd: controleer de winkelopname opnieuw')
  }
  if (product.packAmount === null) {
    missing.push('Inhoud per verpakking ontbreekt: vul de daadwerkelijk gecontroleerde gram, milliliter of stuks in')
  }
  if (product.priceCents === null) {
    missing.push('Eigen waargenomen verpakkingprijs ontbreekt: vul pas na echte broncontrole de eurocentprijs in')
  }
  return missing.length ? missing.join('; ') : null
}
