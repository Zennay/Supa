import { pathToFileURL } from 'node:url'
import { compareLocalRetailerSnapshots } from './retailer-compare-local-snapshots.mjs'
import { priceInstantNs } from '../src/data/schemaOrgProduct.ts'

const money = cents => '€' + (cents / 100).toFixed(2).replace('.', ',')
const safe = cents => Number.isSafeInteger(cents) && cents >= 0


// Terminal output must not interpret untrusted demand text as ANSI, bidi
// reordering or a new line of apparently verified financial evidence.
function safeIngredientLabel(raw) {
  if (typeof raw !== 'string') return 'onbekend ingrediënt'
  const clean = raw.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, ' ')
    .replace(/\s+/gu, ' ').trim().slice(0, 100)
  return clean || 'onbekend ingrediënt'
}

// Reconcile every claimed matched line with integer whole packs before
// displaying any confident basket-level money. Shared physical packs are
// counted once (covered rows are zero additional packs, not free items).
function hasPhysicalBasketProof(comparison) {
  if (!Array.isArray(comparison.lines) || comparison.lines.length === 0) return false
  for (const shop of ['plus', 'dekamarkt']) {
    let sum = 0
    for (const line of comparison.lines) {
      const row = line?.[shop]
      if (!row || row.status !== 'matched' || !safe(row.packPriceCents) ||
          !Number.isSafeInteger(row.packs) || row.packs < 0 ||
          (row.packs === 0 && typeof row.sharedPackWithIngredientId !== 'string')) {
        return false
      }
      const physicalCost = row.packs * row.packPriceCents
      if (!safe(physicalCost) || row.totalCents !== physicalCost) return false
      sum += physicalCost
      if (!safe(sum)) return false
    }
    if (comparison.stores?.[shop]?.subtotalCents !== sum) return false
  }
  return true
}

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
      !Array.isArray(c.lines) || c.lines.length === 0 || c.lines.length > 500 ||
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
      /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:[.][0-9]{1,9})?)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(source.capturedAt) &&
      priceInstantNs(source.capturedAt, false) !== null
      ? source.capturedAt : 'registratietijd onbekend'
    out.push('  ' + name + ': ' + (Number.isSafeInteger(source?.parsedProducts) &&
      source.parsedProducts >= 0 ? source.parsedProducts : 0) +
      ' productobservaties · vastgelegd ' + clock)
  }
  out.push('', 'Mandregels:')
  for (const line of c.lines) {
    const label = safeIngredientLabel(line?.ingredient)
    out.push('  ' + label + ':')
    out.push('    PLUS: ' + describe(line?.plus))
    out.push('    DekaMarkt: ' + describe(line?.dekamarkt))
    const delta = line?.differenceCents
    const expectedDelta = safe(line?.dekamarkt?.totalCents) && safe(line?.plus?.totalCents) ?
      line.dekamarkt.totalCents - line.plus.totalCents : null
    const safeDelta = Number.isSafeInteger(delta) &&
      expectedDelta === delta && Number.isSafeInteger(expectedDelta) &&
      line?.plus?.status === 'matched' && line?.dekamarkt?.status === 'matched' &&
      safe(line.plus.packPriceCents) && safe(line.dekamarkt.packPriceCents) &&
      Number.isSafeInteger(line.plus.packs) && Number.isSafeInteger(line.dekamarkt.packs) &&
      line.plus.packs >= 0 && line.dekamarkt.packs >= 0 &&
      line.plus.packs * line.plus.packPriceCents === line.plus.totalCents &&
      line.dekamarkt.packs * line.dekamarkt.packPriceCents === line.dekamarkt.totalCents
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
      hasPhysicalBasketProof(c) && safeBasket &&
      c.savingsCents === Math.abs(basketDifference) &&
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
