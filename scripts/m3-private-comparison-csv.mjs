import { readFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

import { buildPrivateM3ProductComparison } from './m3-private-product-comparison.mjs'
import { renderPrivateM3ProductComparisonHtml } from './m3-private-comparison-html.mjs'
import { snapshotPrivateM3Comparison } from './m3-private-comparison-snapshot.mjs'
import {
  assertNoSymlinkedM3OutputParents,
  writeDerivedM3Output,
  privateM3OutputFailure,
} from './m3-source-output-preservation.mjs'

// Semicolon-separated UTF-8 spreadsheet export for local field-review only.
// The *independently validating* HTML renderer rejects forged report totals,
// contradictory line prices, missing basket rows, and public-claim escalation.
// Keep this CSV renderer add-only; never bypass the canonical M3 gates.
function cell(value, { untrustedText = false } = {}) {
  const raw = value === null || value === undefined ? '' : String(value)
  // In office spreadsheets, quoted cells can still become formulas. A user
  // product label starting with =, +, -, @ (even after whitespace) must
  // remain literal text, not execute formula or DDE/URL side effects.
  // Control characters can masquerade as cell/row separators.
  const clean = raw.replace(/[\u0000-\u001f\u007f-\u009f\ufeff]/g, ' ')
  const safe = untrustedText && /^[\s\u200b-\u200d]*[=+\-@]/u.test(clean)
    ? "'" + clean
    : clean
  return '"' + safe.replace(/"/g, '""') + '"'
}

function money(cents) {
  if (!Number.isSafeInteger(cents)) return ''
  const amount = BigInt(cents)
  const minus = amount < 0n ? '-' : ''
  const mag = amount < 0n ? -amount : amount
  return minus + String(mag / 100n) + ',' + String(mag % 100n).padStart(2, '0')
}

function row(values) {
  return values.map(({ v, text = false }) => cell(v, { untrustedText: text })).join(';')
}
const t = v => ({ v, text: true })
const n = v => ({ v })
const HEADERS = [
  'Ingrediënt', 'Benodigd', 'Eenheid',
  'PLUS product', 'PLUS pakgrootte', 'PLUS pakeenheid',
  'PLUS stuks per verpakking', 'PLUS benodigde pakken', 'PLUS prijs per pak (EUR)',
  'PLUS regeltotaal (EUR)',
  'DekaMarkt product', 'DekaMarkt pakgrootte', 'DekaMarkt pakeenheid',
  'DekaMarkt stuks per verpakking', 'DekaMarkt benodigde pakken',
  'DekaMarkt prijs per pak (EUR)', 'DekaMarkt regeltotaal (EUR)',
  'Deka - PLUS (EUR)', 'Regelstatus',
]

function productValues(p) {
  if (p.status === 'unresolved') {
    return [t('Niet gemeten / niet beschikbaar'), n(''), n(''), n(''),
      n(''), n(''), n('')]
  }
  if (p.status !== 'known') throw new Error('M3 CSV product status invalid')
  return [
    t(p.productName), n(p.packAmount), t(p.packUnit),
    n(p.itemsPerPackage), n(p.packages),
    n(money(p.pricePerPackageCents)), n(money(p.lineTotalCents)),
  ]
}

export function renderPrivateM3ComparisonCsv(report) {
  // This method validates totals and all eleven physical demand rows, rejecting
  // forged savings or status and negative/overflow cents before any CSV output.
  const snapshot = snapshotPrivateM3Comparison(report)
  renderPrivateM3ProductComparisonHtml(snapshot)
  // Both the financial validation and every exported cell use immutable local
  // ordinary data. A caller's getters/prototypes cannot influence the CSV.
  const data = snapshot.lines.map((line) => {
    const plus = line.plus.status === 'known'
    const deka = line.dekamarkt.status === 'known'
    const comparable = plus && deka
    return row([
      t(line.ingredientLabel), n(line.requiredAmount), t(line.requiredUnit),
      ...productValues(line.plus), ...productValues(line.dekamarkt),
      n(comparable ? money(line.provisionalLineDeltaCents) : ''),
      t(comparable ? 'Voorlopig vergelijkbaar' : 'Onbekend / niet volledig'),
    ])
  })
  const full = snapshot.fullBasket
  // Never present partial known subtotals as full basket totals or a retailer
  // winner. The verified-retailer flag is always FALSE for this private draft.
  const summary = Array.from({ length: HEADERS.length }, () => n(''))
  summary[0] = t(full.comparable
    ? 'VOORLOPIGE VOLLEDIGE MAND' : 'VOLLEDIGE MAND ONBEKEND')
  if (full.comparable) {
    // Keep every cent value under its actual spreadsheet column, rather
    // than placing a store total beneath the unrelated demand column.
    summary[9] = n(money(full.plusTotalCents))
    summary[16] = n(money(full.dekamarktTotalCents))
    summary[17] = n(money(full.deltaCents))
    summary[18] = t('Uitsluitend lokaal, niet onafhankelijk geverifieerd')
  } else {
    summary[18] = t('Niet alle producten/evidence vergelijkbaar')
  }
  const footer = row(summary)
  const header = row(HEADERS.map(t))
  const advisory = row([
    t('PRIVE / NIET GEVERIFIEERD'), t('Geen actuele prijsfeed en geen publieke besparingsclaim'),
  ])
  // UTF-8 BOM for spreadsheet compatibility; no formulas/macros, links, API
  // calls or external resources. The file is always a private derived output.
  return '\ufeff' + [advisory, header, ...data, footer].join('\r\n') + '\r\n'
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    const usage = [
      'Supa · priv\u00e9 PLUS/DekaMarkt producten vergelijken als CSV (M3)',
      '',
      'Vul dezelfde 11 boodschappenbehoeften in bij beide winkels.',
      'Noteer echt gemeten prijzen, beschikbaarheid en verpakking binnen 24 uur.',
      'Gebruik \u00e9\u00e9n prijscontext en bewaar brongegevens lokaal en priv\u00e9.',
      '',
      'Van lokaal M3-veldformulier rechtstreeks naar CSV (Excel):',
      '  node --experimental-strip-types scripts/m3-private-comparison-csv.mjs --sheet <veldformulier.json> --output <priv\u00e9-prijzen.csv>',
      '',
      'Of exporteer een al gemaakte lokale priv\u00e9-vergelijking:',
      '  node --experimental-strip-types scripts/m3-private-comparison-csv.mjs <vergelijking.json> --output <priv\u00e9-prijzen.csv>',
      '',
      'De CSV gebruikt puntkomma-kolommen, bedragen in EUR en priv\u00e9bestandsrechten (0600).',
      'Onbekende prijzen blijven onbekend; een voorlopige winnaar is GEEN publieke besparingsclaim.',
      'Geen scraping, automatische retailerprijzen, upload of onafhankelijke verificatie.',
    ].join('\n')
    process.stdout.write(usage + '\n')
    return usage
  }
  const fromSheet = argv.length === 4 && argv[0] === '--sheet' && argv[2] === '--output'
  const fromComparison = argv.length === 3 && argv[1] === '--output'
  const input = fromSheet ? argv[1] : argv[0]
  const output = fromSheet ? argv[3] : argv[2]
  if ((!fromSheet && !fromComparison) ||
      typeof input !== 'string' || !input || input.startsWith('-') ||
      typeof output !== 'string' || !output || output.startsWith('-') ||
      output !== output.trim()) {
    throw new Error('usage: m3-private-comparison-csv [--sheet] <local-m3-sheet-or-comparison.json> --output <private-comparison.csv>')
  }
  let parsed
  try {
    parsed = JSON.parse(await readFile(input, 'utf8'))
  } catch {
    throw new Error('private M3 comparison input could not be read')
  }
  const report = fromSheet ? buildPrivateM3ProductComparison(parsed) : parsed
  const csv = renderPrivateM3ComparisonCsv(report)
  try {
    await assertNoSymlinkedM3OutputParents(output)
    await mkdir(dirname(output), { recursive: true, mode: 0o700 })
    await writeDerivedM3Output(input, output, csv)
  } catch (error) {
    throw privateM3OutputFailure(error)
  }
  return csv
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write('M3 private CSV comparison could not be generated\n')
    process.exitCode = 1
  })
}
