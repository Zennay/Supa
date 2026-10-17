/**
 * Static, offline HTML dashboard for SUPA's real six-shape M3 preflight.
 * This is a VIEW of privacy-safe aggregate diagnostics, not a scraper,
 * current price feed, rights grant, deploy, or field-evidence substitute.
 *
 * Run: node --experimental-strip-types scripts/retailer-m3-operator-dashboard.mjs > /tmp/supa-m3-review.html
 * Or: ... --at 2026-10-16T12:00:00.000Z
 * Or: ... --dir /path/to/already-reviewed-private-manifest
 */
import { types as nodeTypes } from 'node:util'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { main as runPreflight } from './retailer-private-m3-ingestion-preflight.mjs'

const refuse = () => { throw new Error('Private M3 operator dashboard refused') }
const STORES = ['plus', 'dekamarkt']
const KINDS = ['product', 'catalog', 'offers']
const HISTORICAL_STATUSES = new Set([
  'no-accepted-historical-capture',
  'rejected-historical-input-needs-review',
  'archived-capture-outside-review-window',
  'historical-fixture-present',
])
const ACTIONS = Object.freeze({
  'review-missing-adapter-shapes': 'Controleer ontbrekende historische bronsoorten.',
  'collect-permitted-replacement-snapshots-after-review': 'Controleer verouderde archiefbronnen; maak alleen nieuwe snapshots na aantoonbare toestemming.',
  'resolve-conflicting-archived-product-facts': 'Beoordeel tegenstrijdige historische productgegevens.',
  'review-additional-archived-source-events-outside-offer-comparison': 'Controleer extra historische bronmomenten buiten de aanbiedingenvergelijking.',
  'review-unknown-historical-retailer-stock': 'Controleer onbekende historische voorraadstatus.',
  'review-unavailable-historical-retailer-stock': 'Controleer historische niet-beschikbaarheid.',
  'review-unverified-historical-offer-baselines': 'Onderzoek historische aanbiedingen zonder betrouwbare basisprijs.',
  'obtain-written-retailer-reuse-rights': 'Verkrijg en verifieer schriftelijke PLUS- en DekaMarkt-bronrechten.',
  'collect-real-11-plus-and-11-dekamarkt-same-context-basket': 'Verzamel een echte mand met 11 PLUS- en 11 DekaMarkt-observaties binnen 24 uur.',
  'pin-actual-main-revision-and-verify-trusted-runner': 'Leg de daadwerkelijke main-revisie vast en controleer de vertrouwde runner.',
})
const count = n => Number.isSafeInteger(n) && n >= 0
const esc = s => s.replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// Direct library callers may supply arbitrary JS. Never execute getters,
// inherited properties or Proxy traps simply to render archived facts.
function dataObject(value) {
  if (value === null || typeof value !== 'object' ||
      Array.isArray(value) || nodeTypes.isProxy(value)) refuse()
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) refuse()
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(descriptors).length > 100 ||
      Reflect.ownKeys(descriptors).some(k =>
        typeof k !== 'string' || !Object.hasOwn(descriptors[k], 'value'))) refuse()
  const copy = Object.create(null)
  for (const [k, descriptor] of Object.entries(descriptors)) copy[k] = descriptor.value
  return copy
}
function dataArray(value, max) {
  if (!Array.isArray(value) || nodeTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype) refuse()
  const d = Object.getOwnPropertyDescriptors(value)
  const len = d.length?.value
  if (!Number.isSafeInteger(len) || len > max || len < 0 ||
      Reflect.ownKeys(d).length !== len + 1) refuse()
  return Array.from({ length: len }, (_, i) => {
    if (!Object.hasOwn(d[String(i)] ?? {}, 'value')) refuse()
    return d[String(i)].value
  })
}
function readCount(o, key) {
  if (!count(o[key])) refuse()
  return o[key]
}
function clock(value) {
  if (value === null) return 'Geen geaccepteerde archiefopname'
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      !Number.isFinite(Date.parse(value))) refuse()
  return value
}

/** Whitelist projection only: no source URLs, hashes, SKU, prices or HTML from the caller. */
export function renderOfflineM3Dashboard(input) {
  const report = dataObject(input)
  if (report.schemaVersion !== 1 ||
      report.mode !== 'private-m3-integrated-ingestion-preflight' ||
      report.evidence !== 'reviewed-historical-captures-only' ||
      report.releaseDecision !== 'hold' ||
      report.permissionVerified !== false ||
      report.productionEnabled !== false ||
      report.publicSavingsClaimEligible !== false ||
      report.livePricesAvailable !== false ||
      report.currentStockCoverageVerified !== false ||
      report.unavailableCurrentPriceCoverage !== true ||
      report.requiresHumanReview !== true ||
      report.requiresWrittenReuseRights !== true ||
      report.requiresGenuineM3FieldEvidence !== true ||
      report.historicalReviewedOnly !== true ||
      report.liveRequests !== 0 ||
      report.requiredSourceShapes !== 6 ||
      !['bundled-historical-fixtures','operator-private-manifest','reviewed-in-memory-batch'].includes(report.inputMode)) refuse()

  const updated = clock(report.reviewedAt)
  if (updated === 'Geen geaccepteerde archiefopname') refuse()
  const total = readCount(report, 'acceptedHistoricalObservations')
  const products = readCount(report, 'normalizedPrivateProducts')
  const conflicts = readCount(report, 'conflictingPrivateProducts')
  const unknown = readCount(report, 'historicalStockUnknownObservations')
  const unavailable = readCount(report, 'historicalStockUnavailableObservations')
  const available = readCount(report, 'historicalStockAvailableObservations')
  const accepted = readCount(report, 'acceptedSourceShapes')
  const missing = readCount(report, 'missingSourceShapes')
  // The historical offer reviewer compares only the latest of six shapes.
  // Never conceal older excluded offers or call a linked normal-price baseline
  // a verified discount: these are private *source evidence counts* only.
  const offerRows = readCount(report, 'archivedOfferRows')
  const allOfferRows = readCount(report, 'allHistoricalOfferRows')
  const olderOffers = readCount(report, 'olderHistoricalOfferRowsNotCompared')
  const baselineLinked = readCount(report, 'corroboratedHistoricalOfferBaselines')
  const baselineUnknown = readCount(report, 'uncorroboratedHistoricalOfferRows')
  const unknownWindows = readCount(report, 'unknownOfferWindows')
  const invalidDiscounts = readCount(report, 'invalidDiscountClaims')
  const historicalEvents = readCount(report, 'historicalSourceEvents')
  const selectedEvents = readCount(report, 'selectedSourceEventsForOfferReview')
  const outsideEvents = readCount(report, 'sourceEventsOutsideOfferReview')
  if (offerRows + olderOffers !== allOfferRows ||
      baselineLinked + baselineUnknown !== offerRows ||
      selectedEvents !== 6 || selectedEvents + outsideEvents !== historicalEvents ||
      unknownWindows > offerRows || invalidDiscounts > offerRows) refuse()
  if (unknown + unavailable + available !== total ||
      accepted > 6 || missing > 6 || accepted + missing !== 6 ||
      conflicts > products) refuse()

  const seen = new Set()
  let sum = 0, sumUnknown = 0, sumUnavailable = 0, sumAvailable = 0
  const entries = dataArray(report.perSourceShape, 6)
  if (entries.length !== 6) refuse()
  const shapes = entries.map(entry => {
    const row = dataObject(entry)
    if (!STORES.includes(row.retailer) || !KINDS.includes(row.kind) ||
        !HISTORICAL_STATUSES.has(row.historicalStatus)) refuse()
    const key = row.retailer + ':' + row.kind
    if (seen.has(key)) refuse()
    seen.add(key)
    const n = readCount(row, 'archivedObservations')
    const u = readCount(row, 'unknownHistoricalAvailability')
    const a = readCount(row, 'availableHistoricalObservations')
    const na = readCount(row, 'unavailableHistoricalObservations')
    const acceptedSources = readCount(row, 'acceptedHistoricalSources')
    const rejectedSources = readCount(row, 'rejectedHistoricalSources')
    const stale = readCount(row, 'staleHistoricalSources')
    if (u + a + na !== n ||
        row.verifiedCurrentPriceObservations !== 0) refuse()
    sum += n; sumUnknown += u; sumUnavailable += na; sumAvailable += a
    return { retailer: row.retailer, kind: row.kind,
      status: row.historicalStatus, archived: n, unknown: u,
      unavailable: na, acceptedSources, rejectedSources, stale,
      timestamp: clock(row.latestArchivedCapturedAt) }
  })
  if (seen.size !== 6 || sum !== total || sumUnknown !== unknown ||
      sumUnavailable !== unavailable || sumAvailable !== available) refuse()

  const actions = dataArray(report.operatorActions, 24).map(action => {
    if (typeof action !== 'string' || !Object.hasOwn(ACTIONS, action)) refuse()
    return ACTIONS[action]
  })
  if (!actions.includes(ACTIONS['obtain-written-retailer-reuse-rights']) ||
      !actions.includes(ACTIONS['collect-real-11-plus-and-11-dekamarkt-same-context-basket'])) refuse()

  const section = (id, label) => {
    const rows = shapes.filter(row => row.retailer === id)
      .sort((a,b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind))
      .map(row => `<tr><th scope="row">${esc(row.kind)}</th><td>${row.acceptedSources}</td><td>${row.rejectedSources}</td><td>${row.stale}</td><td>${row.archived}</td><td>${row.unknown}</td><td><span class="status">${esc(row.status)}</span><small>${esc(row.timestamp)}</small></td></tr>`).join('')
    return `<section aria-labelledby="${id}"><h2 id="${id}">${label}</h2><div class="scroll"><table><caption>Uitsluitend historische, gecontroleerde bronmomenten</caption><thead><tr><th scope="col">Bron</th><th scope="col">Geaccepteerd</th><th scope="col">Geweigerd</th><th scope="col">Verouderd</th><th scope="col">Observaties</th><th scope="col">Voorraad onbekend</th><th scope="col">Archiefstatus en opnametijd</th></tr></thead><tbody>${rows}</tbody></table></div></section>`
  }
  return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>SUPA · privé M3 broncontrole</title>
<style>
:root{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#10273a;background:#f3f7f8}*{box-sizing:border-box}
body{margin:0}main{max-width:1200px;margin:auto;padding:30px 20px 60px}
header{background:#092c39;color:white;padding:38px 20px}header>div{max-width:1200px;margin:auto}
.eyebrow{letter-spacing:.15em;text-transform:uppercase;font-size:.8rem;color:#b9e2d4}
h1{font-size:clamp(1.7rem,4vw,2.6rem);margin:.2em 0}h2{font-size:1.25rem}
.notice{border-left:5px solid #af5600;background:#fff8e9;padding:18px 22px;margin:24px 0}
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
.metric{background:white;border:1px solid #deeaec;border-radius:12px;padding:20px}.metric strong{display:block;font-size:2rem}.metric span{font-size:.88rem}
section{margin-top:26px;background:white;border:1px solid #deeaec;border-radius:12px;padding:20px}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;text-align:left;font-size:.88rem}
caption{text-align:left;font-size:.83rem;color:#526b79;margin-bottom:12px}th,td{padding:12px;border-bottom:1px solid #e6edef;vertical-align:top}thead{background:#f2f7f8}
.status{font-weight:650;overflow-wrap:anywhere}small{display:block;margin-top:5px;color:#566b73;overflow-wrap:anywhere}
li{margin:.7em 0;line-height:1.5}footer{margin-top:30px;color:#435b67;font-size:.87rem}
</style></head>
<body><header><div><p class="eyebrow">SUPA · M3 / besloten operatorcontrole</p><h1>Historische supermarktbronnen</h1><p>PLUS + DekaMarkt · Alleen offline geverifieerde archiefgegevens</p></div></header>
<main><div class="notice" role="status"><strong>HOLD — niet vrijgegeven.</strong><p>Geen bewezen actuele prijzen of voorraad, geen live scraper, geen publiek besparingsbewijs. Schriftelijke bronrechten en de echte 11×2 veldmand ontbreken. Een groen technisch archiefresultaat verandert dit niet.</p><small>Beoordelingsmoment: ${esc(updated)}</small></div>
<div class="metrics" aria-label="Historische broncijfers">
<div class="metric"><strong>${accepted}/6</strong><span>Archiefbronsoorten geaccepteerd</span></div>
<div class="metric"><strong>${total}</strong><span>Historische observaties</span></div>
<div class="metric"><strong>${products}</strong><span>Privé productidentiteiten</span></div>
<div class="metric"><strong>${conflicts}</strong><span>Te beoordelen conflicten</span></div>
<div class="metric"><strong>${unknown}</strong><span>Historische voorraad onbekend</span></div>
<div class="metric"><strong>${unavailable}</strong><span>Historisch niet beschikbaar</span></div></div>
${section('plus','PLUS')}${section('dekamarkt','DekaMarkt')}
<section aria-labelledby="offers"><h2 id="offers">Historische aanbiedingen — géén actuele korting</h2>
<p>Dit zijn alleen geverifieerde archiefcontroles, niet de winkelprijzen van vandaag. Een technisch gekoppelde basisprijs bewijst nog geen geldige aanbieding of werkelijke besparing.</p>
<div class="metrics" aria-label="Historische aanbiedingcontrole">
<div class="metric"><strong>${offerRows}</strong><span>Archiefaanbiedingen bekeken</span></div>
<div class="metric"><strong>${baselineLinked}</strong><span>Historische basisprijzen technisch gekoppeld</span></div>
<div class="metric"><strong>${baselineUnknown}</strong><span>Basisprijs niet bevestigd</span></div>
<div class="metric"><strong>${unknownWindows}</strong><span>Onzeker aanbiedingsvenster</span></div>
<div class="metric"><strong>${invalidDiscounts}</strong><span>Ongeldige kortingsclaims</span></div>
<div class="metric"><strong>${olderOffers}</strong><span>Oudere aanbiedingen niet vergeleken</span></div></div>
<p>Geselecteerde bronmomenten: ${selectedEvents} van ${historicalEvents}; extra historische momenten buiten deze aanbiedingcontrole: ${outsideEvents}. Een echte 11×2-veldmand en bronrechten zijn nog steeds vereist.</p></section>
<section aria-labelledby="next"><h2 id="next">Nog te doen</h2><ol>${actions.map(a => `<li>${esc(a)}</li>`).join('')}</ol></section>
<footer>Bron: lokale SHA-gecontroleerde M3-voorcontrole. Geen individuele SKU, winkelprijs, bron-URL, hash of klantgegevens opgenomen. Dit document is geen productie- of publicatietoestemming.</footer>
</main></body></html>\n`
}

/** Reuse the existing admissible --at / --dir CLI verbatim; no new IO surface. */
export async function main(argv = process.argv.slice(2),
  write = html => process.stdout.write(html)) {
  const report = await runPreflight(argv, () => {})
  const html = renderOfflineM3Dashboard(report)
  write(html)
  return { status: 'hold', shapeCount: 6, htmlBytes: Buffer.byteLength(html) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private M3 operator dashboard refused')
    process.exitCode = 2
  })
}
