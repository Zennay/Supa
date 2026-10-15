import { pathToFileURL } from 'node:url'
import { compareLocalRetailerSnapshots } from './retailer-compare-local-snapshots.mjs'

const money = cents => '€' + (cents / 100).toFixed(2).replace('.', ',')
const safe = cents => Number.isSafeInteger(cents) && cents >= 0

function describe(row) {
  if (!row || row.status === 'unknown') return 'niet gevonden'
  if (row.status !== 'matched' && row.status !== 'availability_unknown') return 'niet vergelijkbaar'
  if (row.status === 'availability_unknown') return 'voorraad onbekend: geen betrouwbare aankoopprijs'
  if (!safe(row.packPriceCents) || !safe(row.totalCents) ||
      !Number.isSafeInteger(row.packs) || row.packs < 0) return 'prijs onbetrouwbaar'
  // A formatter should not turn a forged or accidentally corrupted row
  // into a believable price; the integer pack cost must equal the subtotal.
  if (!safe(row.packs * row.packPriceCents) ||
      row.totalCents !== row.packs * row.packPriceCents) return 'prijs onbetrouwbaar'
  if (row.packs === 0) return row.sharedPackWithIngredientId ?
    'onderdeel gedeeld pak (niet gratis)' : 'niet vergelijkbaar'
  return row.packs + ' × ' + money(row.packPriceCents) + ' = ' + money(row.totalCents)
}

/** Human-readable operator preview. Do not print file paths or source URLs. */
export function renderPrivateComparison(report) {
  const c = report?.comparison
  if (report?.format !== 'supa-local-snapshot-comparison-v1' ||
      !Array.isArray(report.captureSummary) || !c ||
      c.provenance !== 'offline-snapshot-preview' || c.claimable !== false ||
      !Array.isArray(c.lines) || c.lines.length > 500 ||
      !c.stores?.plus || !c.stores?.dekamarkt) {
    throw new Error('Invalid or claimable offline comparison')
  }
  const out = [
    'SUPA · PRIVATE OFFLINE BOODSCHAPPENVERGELIJKING',
    'GEEN LIVE PRIJZEN · GEEN GEVERIFIEERDE EUROBESPARING',
    '', 'Bronnen: lokale bestanden, geen retailer-netwerkverzoek',
  ]
  for (const source of report.captureSummary) {
    const name = source?.supermarket === 'plus' ? 'PLUS' :
      source?.supermarket === 'dekamarkt' ? 'DekaMarkt' : 'onbekend'
    const clock = typeof source?.capturedAt === 'string' &&
      /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}/.test(source.capturedAt)
      ? source.capturedAt : 'registratietijd onbekend'
    out.push('  ' + name + ': ' + (Number.isSafeInteger(source?.parsedProducts) &&
      source.parsedProducts >= 0 ? source.parsedProducts : 0) +
      ' productobservaties · vastgelegd ' + clock)
  }
  out.push('', 'Mandregels:')
  for (const line of c.lines) {
    const label = typeof line?.ingredient === 'string' && line.ingredient.trim() ?
      line.ingredient.replaceAll(String.fromCharCode(10), ' ').replaceAll(String.fromCharCode(13), ' ').replaceAll(String.fromCharCode(9), ' ').slice(0, 100) : 'onbekend ingrediënt'
    out.push('  ' + label + ':')
    out.push('    PLUS: ' + describe(line?.plus))
    out.push('    DekaMarkt: ' + describe(line?.dekamarkt))
    const delta = line?.differenceCents
    const safeDelta = Number.isSafeInteger(delta) && Number.isSafeInteger(Math.abs(delta)) &&
      line?.plus?.status === 'matched' && line?.dekamarkt?.status === 'matched'
    out.push('    Offline regelverschil: ' + (safeDelta ?
      (delta < 0 ? 'DekaMarkt lager ' : delta > 0 ? 'PLUS lager ' : 'gelijk ') + money(Math.abs(delta))
      : 'niet aantoonbaar'))
  }
  const p = c.stores.plus
  const d = c.stores.dekamarkt
  out.push('', 'Bekend subtotaal PLUS: ' + (safe(p.subtotalCents) ? money(p.subtotalCents) : 'onbekend'))
  out.push('Bekend subtotaal DekaMarkt: ' + (safe(d.subtotalCents) ? money(d.subtotalCents) : 'onbekend'))
  const basketDifference = safe(p.subtotalCents) && safe(d.subtotalCents) ?
    d.subtotalCents - p.subtotalCents : null
  const safeBasket = basketDifference !== null && Number.isSafeInteger(basketDifference)
  const computedWinner = !safeBasket ? null : basketDifference > 0 ? 'plus' :
    basketDifference < 0 ? 'dekamarkt' : 'equal'
  if (c.comparable === true && p.complete === true && d.complete === true &&
      safeBasket && c.savingsCents === Math.abs(basketDifference) &&
      c.cheaperStore === computedWinner) {
    const winner = c.cheaperStore === 'equal' ? 'gelijke prijs' :
      c.cheaperStore === 'plus' ? 'PLUS lager' : 'DekaMarkt lager'
    out.push('ALLEEN OFFLINE MANDVERSCHIL: ' + winner + ' ' + money(c.savingsCents))
  } else out.push(c.reason === 'invalid_or_stale_source'
    ? 'GEEN VOLLEDIGE MANDVERGELIJKING: bronregistratie is ongeldig of ouder dan de M3-venstergrens'
    : 'GEEN VOLLEDIGE MANDVERGELIJKING: ontbrekende/onzekere producten of voorraad')
  out.push('Niet gebruiken als live winkeladvies of bewezen besparing.', '')
  return out.join(String.fromCharCode(10))
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1) throw new Error('Gebruik: node --experimental-strip-types scripts/retailer-show-private-comparison.mjs manifest.json')
  const report = await compareLocalRetailerSnapshots(argv[0])
  console.log(renderPrivateComparison(report))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
