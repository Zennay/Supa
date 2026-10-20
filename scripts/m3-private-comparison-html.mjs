import { readFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildPrivateM3ProductComparison } from './m3-private-product-comparison.mjs'
import { privateM3PackUnitPrice } from './m3-private-pack-unit-price.mjs'
import { snapshotPrivateM3Comparison } from './m3-private-comparison-snapshot.mjs'
import {
  assertNoSymlinkedM3OutputParents,
  writeDerivedM3Output,
  privateM3OutputFailure,
} from './m3-source-output-preservation.mjs'

// This renderer is deliberately independent from Supa's live Vergelijk UI.
// It produces a private offline document, not an approved retailer feed.
function html(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function isCents(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function sumCents(values) {
  const sum = values.reduce((acc, cents) => acc + BigInt(cents), 0n)
  return sum <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(sum) : null
}

// BigInt formatting avoids fractional binary/euro rounding even for high cents.
function euros(cents, { signed = false } = {}) {
  if (!Number.isSafeInteger(cents)) return 'Prijs onbekend'
  const amount = BigInt(cents)
  const negative = amount < 0n
  const magnitude = negative ? -amount : amount
  const sign = negative ? '−' : (signed && amount > 0n ? '+' : '')
  return sign + '€ ' + String(magnitude / 100n) + ',' +
    String(magnitude % 100n).padStart(2, '0')
}

function productAmount(row) {
  if (!row || (row.status !== 'known' && row.status !== 'unresolved')) {
    throw new Error('M3 comparison contains an invalid product row')
  }
  if (row.status === 'unresolved') {
    if (row.lineTotalCents !== null || row.pricePerPackageCents !== null) {
      throw new Error('unresolved M3 product cannot carry monetary totals')
    }
    return null
  }
  if (typeof row.productName !== 'string' || !row.productName.trim() ||
      !Number.isSafeInteger(row.packages) || row.packages <= 0 ||
      !isCents(row.pricePerPackageCents) || !isCents(row.lineTotalCents) ||
      !Number.isFinite(row.packAmount) || row.packAmount <= 0 ||
      !Number.isSafeInteger(row.itemsPerPackage) || row.itemsPerPackage <= 0 ||
      typeof row.packUnit !== 'string') {
    throw new Error('known M3 product has invalid pack or price')
  }
  if (BigInt(row.packages) * BigInt(row.pricePerPackageCents) !==
      BigInt(row.lineTotalCents)) {
    throw new Error('M3 product pack and line total disagree')
  }
  return row.lineTotalCents
}

function checkedRows(report) {
  if (!report || report.schemaVersion !== 1 ||
      report.reportType !== 'm3-private-observed-product-comparison' ||
      report.privateOnly !== true ||
      report.verifiedRetailerObservations !== false ||
      report.publicSavingsClaimEligible !== false ||
      !Array.isArray(report.lines) || report.lines.length !== 11 ||
      !report.fullBasket || !report.knownSubtotalsCents) {
    throw new Error('M3 HTML requires an unverified private canonical comparison')
  }
  const seen = new Set()
  const rows = report.lines.map((line) => {
    if (!line || typeof line.ingredientId !== 'string' ||
        !/^[a-z0-9][a-z0-9_-]*$/.test(line.ingredientId) ||
        seen.has(line.ingredientId) ||
        typeof line.ingredientLabel !== 'string' || !line.ingredientLabel.trim() ||
        !Number.isFinite(line.requiredAmount) || line.requiredAmount <= 0 ||
        typeof line.requiredUnit !== 'string') {
      throw new Error('M3 HTML ingredient identity or physical amount invalid')
    }
    seen.add(line.ingredientId)
    const plus = productAmount(line.plus)
    const deka = productAmount(line.dekamarkt)
    const delta = plus !== null && deka !== null ? deka - plus : null
    if (line.provisionalLineDeltaCents !== delta) {
      throw new Error('M3 HTML must not display a forged or stale price delta')
    }
    return { line, plus, deka, delta }
  })

  const plusTotal = sumCents(rows.map(row => row.plus).filter(v => v !== null))
  const dekaTotal = sumCents(rows.map(row => row.deka).filter(v => v !== null))
  if (plusTotal === null || dekaTotal === null ||
      report.knownSubtotalsCents.plus !== plusTotal ||
      report.knownSubtotalsCents.dekamarkt !== dekaTotal) {
    throw new Error('M3 HTML known subtotal mismatch')
  }
  const full = report.fullBasket
  if (full.comparable === true) {
    const delta = dekaTotal - plusTotal
    if (rows.some(row => row.delta === null) ||
        report.knownSubtotalsCents.incompleteBasket !== false ||
        full.plusTotalCents !== plusTotal ||
        full.dekamarktTotalCents !== dekaTotal ||
        !Number.isSafeInteger(delta) ||
        full.deltaCents !== delta ||
        full.provisionalSavingsCents !== -delta ||
        full.outcome !== (delta < 0 ? 'better' : delta > 0 ? 'worse' : 'same')) {
      throw new Error('M3 HTML must not render an untrusted basket winner')
    }
  } else if (
    full.comparable !== false || full.outcome !== 'unknown' ||
    full.plusTotalCents !== null || full.dekamarktTotalCents !== null ||
    full.deltaCents !== null || full.provisionalSavingsCents !== null ||
    report.knownSubtotalsCents.incompleteBasket !== true
  ) {
    throw new Error('M3 HTML incomplete basket must remain unknown')
  }
  return rows
}

export function renderPrivateM3ProductComparisonHtml(untrustedReport) {
  // One authoritative data snapshot for validation AND rendering. Never
  // re-read an accessor-backed original after the monetary safety checks.
  const report = snapshotPrivateM3Comparison(untrustedReport)
  const rows = checkedRows(report)
  const full = report.fullBasket
  const header = full.comparable
    ? full.outcome === 'same'
      ? 'Beide volledige mandjes kosten evenveel (voorlopig).'
      : full.outcome === 'better'
        ? 'DekaMarkt is goedkoper voor dit volledige gemeten mandje (voorlopig).'
        : 'PLUS is goedkoper voor dit volledige gemeten mandje (voorlopig).'
    : 'Nog geen betrouwbare winnaar: één of meer veldvoorwaarden ontbreken.'
  const body = rows.map(({ line, plus, deka, delta }) => {
    const product = (row, total) => row.status === 'known'
      ? '<strong>' + html(row.productName) + '</strong><small>' +
          html(String(row.packages)) + ' × ' + html(String(row.packAmount)) +
          ' ' + html(row.packUnit) + ' · ' + euros(row.pricePerPackageCents) +
          ' per pak</small>' +
          (privateM3PackUnitPrice(row) === null
            ? ''
            : '<small>Indicatie: ' +
                (privateM3PackUnitPrice(row).approximate ? 'ca. ' : '') +
                euros(privateM3PackUnitPrice(row).cents) + ' / ' +
                html(privateM3PackUnitPrice(row).basis) +
                '</small>') +
          '<span>' + euros(total) + '</span>'
      : '<span class="missing">Niet betrouwbaar geprijsd</span>'
    return '<tr><th scope="row">' + html(line.ingredientLabel) +
      '<small>' + html(String(line.requiredAmount)) + ' ' +
      html(line.requiredUnit) + '</small></th><td>' +
      product(line.plus, plus) + '</td><td>' +
      product(line.dekamarkt, deka) + '</td><td>' +
      (delta === null ? '<span class="missing">Onbekend</span>' : euros(delta, { signed: true })) +
      '</td></tr>'
  }).join('\n')

  const summary = full.comparable
    ? '<p>PLUS: <strong>' + euros(full.plusTotalCents) +
      '</strong> · DekaMarkt: <strong>' + euros(full.dekamarktTotalCents) +
      '</strong> · Voorlopig prijsverschil (Deka − PLUS): <strong>' +
      euros(full.deltaCents, { signed: true }) + '</strong></p>'
    : '<p>Bekende deeltotalen (geen volledige winkelmandprijzen): PLUS <strong>' +
      euros(report.knownSubtotalsCents.plus) + '</strong>; DekaMarkt <strong>' +
      euros(report.knownSubtotalsCents.dekamarkt) + '</strong>.</p>'

  return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; img-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Privé PLUS–DekaMarkt productvergelijking</title>
<style>
:root{color-scheme:light;font-family:system-ui,-apple-system,sans-serif;color:#182c2c;background:#f6f8f7}
body{max-width:1150px;margin:0 auto;padding:28px 20px 64px}
header{border-bottom:3px solid #135c4e;padding-bottom:22px;margin-bottom:25px}
h1{font-size:clamp(1.5rem,3vw,2.5rem);margin:0 0 9px}
p{line-height:1.55} .warn{background:#fff8e7;border:1px solid #e7c985;padding:14px;border-radius:8px}
.summary{background:white;border-radius:12px;padding:16px 20px;margin:20px 0;box-shadow:0 1px 7px #0001}
table{border-collapse:collapse;width:100%;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 7px #0001}
caption{text-align:left;font-weight:700;padding:12px}
th,td{text-align:left;vertical-align:top;padding:16px 12px;border-bottom:1px solid #e4eae7}
thead{background:#dcefe8} th[scope=row]{min-width:145px}
small{display:block;color:#50645e;line-height:1.5;margin-top:5px}td span{display:block;margin-top:5px}
.missing{color:#725337;font-style:italic}footer{margin-top:26px;font-size:.88rem;color:#59635f}
@media(max-width:700px){body{padding:14px 8px}th,td{padding:10px 6px;font-size:.84rem}th[scope=row]{min-width:90px}}
</style></head><body>
<header><h1>PLUS versus DekaMarkt</h1><p>Privé prijsvergelijking van dezelfde 11 boodschappenbehoeften.</p></header>
<div class="warn"><strong>Niet onafhankelijk geverifieerd.</strong> Dit overzicht gebruikt uitsluitend lokaal ingevoerde winkelwaarnemingen. Het is geen actuele online prijsgarantie en geen openbare besparingsclaim.</div>
<section class="summary"><h2>${html(header)}</h2>${summary}</section>
<table><caption>Prijs per product en benodigde verpakking</caption><thead><tr><th scope="col">Boodschap</th><th scope="col">PLUS</th><th scope="col">DekaMarkt</th><th scope="col">Deka − PLUS</th></tr></thead>
<tbody>${body}</tbody></table>
<footer>Alle bedragen zijn in euro en exact vanuit centen geformatteerd. Ontbrekende producten hebben geen geschatte prijs. Bewijs van echte besparing vereist onafhankelijke beoordeling van dezelfde mand binnen 24 uur.</footer>
</body></html>`
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    // Human-oriented, static help: do not access any participant file, price
    // endpoint or network connection just to discover CLI usage.
    const guide = [
      'Supa · privé PLUS versus DekaMarkt productvergelijking (M3)',
      '',
      '1. Gebruik het canonieke formulier voor dezelfde 11 boodschappen bij beide winkels.',
      '2. Noteer echte prijzen en verpakkingen binnen 24 uur, met dezelfde prijscontext.',
      '3. Bewaar het formulier uitsluitend lokaal; gebruik geen namen of accountgegevens.',
      '',
      'Maak rechtstreeks een leesbaar HTML-overzicht:',
      '  node --experimental-strip-types scripts/m3-private-comparison-html.mjs --sheet <veldformulier.json> --output <vergelijking.html>',
      '',
      'Of gebruik een eerder opgeslagen privé-vergelijkingsbestand:',
      '  node --experimental-strip-types scripts/m3-private-comparison-html.mjs <vergelijking.json> --output <vergelijking.html>',
      '',
      'Het rapport wordt privé opgeslagen (0600). Onbekende prijzen blijven onbekend.',
      'Een voorlopig goedkoopste mandje is geen onafhankelijk geverifieerde besparingsclaim.',
      'De echte PLUS/DekaMarkt-veldmeting en bronrechten blijven afzonderlijk vereist.',
    ].join('\n')
    process.stdout.write(guide + '\n')
    return guide
  }
  const fromSheet = argv.length === 4 && argv[0] === '--sheet' && argv[2] === '--output'
  const fromComparison = argv.length === 3 && argv[1] === '--output'
  const input = fromSheet ? argv[1] : argv[0]
  const output = fromSheet ? argv[3] : argv[2]
  if ((!fromSheet && !fromComparison) ||
      typeof input !== 'string' || !input || input.startsWith('-') ||
      typeof output !== 'string' || !output || output.startsWith('-') ||
      output !== output.trim()) {
    throw new Error('usage: m3-private-comparison-html [--sheet] <local-field-sheet-or-private-comparison.json> --output <private-report.html>')
  }

  let raw
  try {
    raw = JSON.parse(await readFile(input, 'utf8'))
  } catch {
    throw new Error('private M3 comparison input could not be read')
  }
  // One-command local field-sheet mode reuses the identical canonical
  // converter/assessment gates as the separate JSON-to-HTML route. Never
  // invent a retailer price, trust an unverified observation or log raw input.
  const report = fromSheet ? buildPrivateM3ProductComparison(raw) : raw
  const rendered = renderPrivateM3ProductComparisonHtml(report)
  try {
    await assertNoSymlinkedM3OutputParents(output)
    await mkdir(dirname(output), { recursive: true, mode: 0o700 })
    await writeDerivedM3Output(input, output, rendered)
  } catch (error) { throw privateM3OutputFailure(error) }
  return rendered
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write('M3 private HTML comparison could not be generated\n')
    process.exitCode = 1
  })
}
