import type { BasketTraceLine } from '../../domain/basket.ts'

/** Human actions for canonical private matching failures. This text is never
 * evidence that a retailer has a product in stock or an observed price. */
export function unresolvedProductGuidance(line: BasketTraceLine | undefined): string {
  if (!line || line.status !== 'unresolved') return 'Controleer de bronopname en gekozen verpakking.'
  const reasons = line.reasons
  const has = (part: string) => reasons.some(reason => reason.includes(part))
  if (has('amount unknown') || has('amount invalid') || has('requirement amount')) {
    return 'De benodigde hoeveelheid is niet zeker. Controleer dit ingrediënt in Recepten en Planner.'
  }
  if (has('safe integer range') || has('not trusted')) {
    return 'Verpakking, hoeveelheden of prijs kunnen niet veilig worden berekend. Controleer de oorspronkelijke opname.'
  }
  if (has('manual selection absent') || has('matched product missing')) {
    return 'Een eerdere productkeuze staat niet geldig in deze bron. Kies opnieuw uit de geïmporteerde producten.'
  }
  if (has('top candidates too close')) {
    return 'Meerdere bronproducten lijken passend. Controleer en kies zelf de juiste verpakking.'
  }
  if (has('score below trust threshold')) {
    return 'Geen productmatch zeker genoeg. Controleer productnaam en verpakking handmatig.'
  }
  if (has('no candidates') || has('unavailable')) {
    return 'Er is geen geschikte beschikbare verpakking met bruikbare prijs in deze opname. Vul de bron aan.'
  }
  return 'Geen verifieerbare match in de ingelezen opname. Controleer het bronproduct zelf.'
}
