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
    out.push('  ' + name + ': ' + (Number.isSafeInteger(source?.parsedProducts) &&
      source.parsedProducts >= 0 ? source.parsedProducts : 0) + ' productobservaties')
  }
  out.push('', 'Mandregels:')
  for (const line of c.lines) {
    const label = typeof line?.ingredient === 'string' && line.ingredient.trim() ?
      line.ingredient.replace(/[\\r\\n\\t]/g, ' ').slice(0, 100) : 'onbekend ingrediënt'
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
  if (c.comparable === true && p.complete === true && d.complete === true &&
      safe(c.savingsCents) && ['plus', 'dekamarkt', 'equal'].includes(c.cheaperStore)) {
    const winner = c.cheaperStore === 'equal' ? 'gelijke prijs' :
      c.cheaperStore === 'plus' ? 'PLUS lager' : 'DekaMarkt lager'
    out.push('ALLEEN OFFLINE MANDVERSCHIL: ' + winner + ' ' + money(c.savingsCents))
  } else out.push('GEEN VOLLEDIGE MANDVERGELIJKING: ontbrekende/onzekere producten of voorraad')
  out.push('Niet gebruiken als live winkeladvies of bewezen besparing.', '')
  return out.join('\\n')
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1) throw new Error('Gebruik: node --experimental-strip-types scripts/retailer-show-private-comparison.mjs manifest.json')
  const report = await compareLocalRetailerSnapshots(argv[0])
  console.log(renderPrivateComparison(report))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
