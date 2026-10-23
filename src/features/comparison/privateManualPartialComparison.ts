import { euro } from '../../lib/money.ts'
import {
  MANUAL_RETAILERS, manualQuoteKey,
  type ManualComparison, type ManualEntries,
} from '../../domain/manualStoreComparison.ts'

function label(text: unknown): string {
  return typeof text === 'string'
    ? text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim().slice(0, 160)
    : ''
}

/** Offline review of the exact same demand, including missing or invalid lines.
 * Never infer pack identity or show an incomplete basket total as savings. */
export function privateManualPartialComparisonText(
  comparison: ManualComparison, entries: ManualEntries,
): string {
  if (!comparison || !Array.isArray(comparison.rows) ||
      comparison.rows.length < 1 || comparison.rows.length > 100) {
    throw new Error('Geen bruikbare Planner-vraag voor de vergelijking.')
  }
  const rows = [
    'SUPA | Mijn eigen gedeeltelijke PLUS/Deka-vergelijking',
    'PRIVE: uitsluitend eigen handmatige invoer, geen actuele retailerbron of geverifieerde productgelijkheid.',
    'Een bekende regel mag apart vergeleken worden; geen totaalverschil bij ontbrekende prijzen.',
    '',
  ]
  let paired = 0
  let unresolved = 0
  for (const item of comparison.rows) {
    rows.push(`${label(item.label)} | benodigd: ${item.requiredAmount ?? '?'} ${label(item.requiredUnit)}`)
    for (const shop of MANUAL_RETAILERS) {
      const quote = entries[manualQuoteKey(shop, item.ingredientId)]
      const line = item.quotes[shop]
      const shown = line.state === 'complete' && line.lineCents !== null &&
        line.packs !== null && !!quote
      rows.push(shown
        ? `${shop}: ${label(quote!.product)} | ${line.packs} verpakking(en) van ${label(quote!.packCount)} x ${label(quote!.packAmount)} ${label(quote!.packUnit)} | ${euro.formatCents(line.lineCents!)}`
        : `${shop}: ${line.state === 'invalid' ? 'ONGELDIGE eigen verpakking/prijs - controleer' : 'ONTBREEKT - onbekende prijs'}`)
    }
    const plus = item.quotes.PLUS
    const deka = item.quotes.DekaMarkt
    if (plus.state === 'complete' && deka.state === 'complete' &&
        plus.lineCents !== null && deka.lineCents !== null) {
      paired++
      rows.push(`EIGEN HELE-PAKREGELVERSCHIL (Deka minus PLUS): ${euro.formatCents(deka.lineCents - plus.lineCents)}`)
      if (plus.unitPriceCents !== null && deka.unitPriceCents !== null) {
        const unit = item.requiredUnit === 'piece' ? 'stuk' :
          ['g', 'kg'].includes(item.requiredUnit) ? 'kg' : 'liter'
        rows.push(`Afgeronde eigen eenheidsprijzen per ${unit}: PLUS ${euro.formatCents(plus.unitPriceCents)}, Deka ${euro.formatCents(deka.unitPriceCents)}`)
      }
    } else {
      unresolved++
      rows.push('GEEN REGELVERGELIJKING: beide fysieke winkelregels zijn nog niet compleet.')
    }
    rows.push('')
  }
  rows.push(`${paired} vergelijkbare eigen regels, ${unresolved} nog onvergelijkbaar.`,
    'GEEN TOTAALVERSCHIL of bewezen besparing: volledig hetzelfde mandje en eigen winkelproducten eerst controleren.',
    'Geen winkelprijzen opgehaald, geen bronrechten of veldmetingen geclaimd.')
  const output = rows.join('\n') + '\n'
  if (new TextEncoder().encode(output).length > 128000) {
    throw new Error('De persoonlijke vergelijking is te groot.')
  }
  return output
}
