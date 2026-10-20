import { euro } from '../../lib/money.ts'
import {
  MANUAL_RETAILERS, manualQuoteKey,
  type ManualComparison, type ManualEntries, type ManualRetailer,
} from '../../domain/manualStoreComparison.ts'

export type ManualTripCoverage = Readonly<{
  store: ManualRetailer
  known: number
  unresolved: number
  knownSubtotalCents: number
}>

/** Per-store progress from own prices. A partial sum is never a basket total. */
export function manualTripCoverage(
  comparison: ManualComparison,
): readonly ManualTripCoverage[] {
  return MANUAL_RETAILERS.map(store => {
    let known = 0
    let unresolved = 0
    let knownSubtotalCents = 0
    for (const row of comparison.rows) {
      const line = row.quotes[store]
      if (line.state === 'complete' && line.lineCents !== null &&
          Number.isSafeInteger(line.lineCents) && line.lineCents >= 0) {
        known++
        knownSubtotalCents += line.lineCents
      } else {
        unresolved++
      }
    }
    if (!Number.isSafeInteger(knownSubtotalCents) || knownSubtotalCents > 100000000) {
      return { store, known: 0, unresolved: comparison.rows.length, knownSubtotalCents: 0 }
    }
    return { store, known, unresolved, knownSubtotalCents }
  })
}

function safeText(text: unknown): string {
  return typeof text === 'string'
    ? text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim().slice(0, 160)
    : ''
}

/** Personal offline shopping checklist with unpriced and priced items.
 * Does not establish retailer permission, actual current prices or savings. */
export function privateManualShoppingTripText(
  comparison: ManualComparison, entries: ManualEntries, store: ManualRetailer,
): string {
  if (!MANUAL_RETAILERS.includes(store) || !comparison.rows.length ||
      comparison.rows.length > 100) throw new Error('Geen bruikbaar eigen mandje.')
  const coverage = manualTripCoverage(comparison).find(value => value.store === store)!
  const rows = [
    `SUPA | Mijn eigen boodschappen bij ${store}`,
    'PRIVE / HANDMATIG / ONGEVERIFIEERD: geen winkel-SKU, bronmoment of actuele prijsclaim.',
    'Controleer product en prijs zelf in de winkel; dit is geen volledig winkelmandtotaal.',
    `${coverage.known} bekende regels, ${coverage.unresolved} zonder bruikbare eigen prijs.`,
    '', 'PRODUCTEN MET EIGEN INGEVOERDE VERPAKKINGSPRIJS',
  ]
  for (const row of comparison.rows) {
    const line = row.quotes[store]
    if (line.state !== 'complete' || line.lineCents === null || line.packs === null) continue
    const quote = entries[manualQuoteKey(store, row.ingredientId)]
    if (!quote) throw new Error('Winkelinvoer is tussentijds gewijzigd.')
    rows.push(`- [ ] ${safeText(row.label)} | ${safeText(quote.product)} | ${line.packs} hele verpakking(en) ` +
      `van ${safeText(quote.packCount)} x ${safeText(quote.packAmount)} ${safeText(quote.packUnit)} ` +
      `| zelf genoteerd ${euro.formatCents(line.lineCents)}`)
  }
  if (!coverage.known) rows.push('(nog geen productprijzen ingevuld)')
  rows.push('', 'NOG TE CONTROLEREN / ZONDER BRUIKBARE PRIJS')
  for (const row of comparison.rows) {
    const line = row.quotes[store]
    if (line.state === 'complete' && line.lineCents !== null) continue
    rows.push(`- [ ] ${safeText(row.label)} | nodig: ${row.requiredAmount ?? '?'} ${safeText(row.requiredUnit)} ` +
      `| ${line.state === 'invalid' ? 'ingevulde gegevens corrigeren' : 'prijs/product ontbreekt'}`)
  }
  if (!coverage.unresolved) rows.push('(alle regels hebben eigen ingevulde prijzen)')
  rows.push('', `ALLEEN BEKENDE REGELS: ${euro.formatCents(coverage.knownSubtotalCents)} ` +
    '(deelbedrag; GEEN winkelmandtotaal).',
    'Geen winkelbesparing of volledig mandverschil vastgesteld; producten en prijzen opnieuw controleren.')
  const result = rows.join('\n') + '\n'
  if (new TextEncoder().encode(result).length > 128000) {
    throw new Error('De persoonlijke boodschappenlijst is te groot.')
  }
  return result
}
