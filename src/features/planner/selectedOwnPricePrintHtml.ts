import type { ComparedOwnLine } from './ownStoreBudgetComparison.ts'
import { selectedOwnPriceCsv } from './selectedOwnPriceCsv.ts'
import { privateUnitPrice } from '../comparison/privateUnitPrice.ts'
import { privateMatchedUnitPriceGap } from '../products/privateProgressProductRows.ts'
import { readablePlannerDemandAmount } from '../comparison/plannerPriceCaptureGuide.ts'
import { euro } from '../../lib/money.ts'

/** Offline document for a *selection* from an already-admitted full paired basket.
 * The selectedOwnPriceCsv boundary rejects inconsistent identity and line deltas.
 * This is NOT a recalculation of full-basket totals or an independent price claim.
 */
export function selectedOwnPricePrintHtml(input: {
  lines: readonly ComparedOwnLine[]
  totalOriginalLines: number
  plusObservedAt: string
  dekaObservedAt: string
}): string {
  // Reuse the existing strict selected-price ledger admission, without
  // exposing a second, weaker HTML route to potentially forged prices.
  selectedOwnPriceCsv(input)
  const esc = (value: unknown): string => String(value ?? '')
    .replace(/&/gu, '&amp;').replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;').replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;')
  const store = (line: ComparedOwnLine['plus']): string =>
    '<strong>' + esc(line.productName) + '</strong>' +
    '<small>SKU ' + esc(line.productId) + '</small>' +
    '<span>' + esc(line.packs) + ' hele verpakking(en), ' +
      esc(line.pack.count) + ' × ' + esc(readablePlannerDemandAmount(line.pack.amount)) +
      ' ' + esc(line.pack.unit) + ' per pak</span>' +
    '<span>' + esc(euro.formatCents(line.pricePerPackCents)) + ' per pak</span>' +
    '<span>' + esc(privateUnitPrice(line) ?? 'Eenheidsprijs onbekend') + '</span>' +
    '<strong>' + esc(euro.formatCents(line.lineTotalCents)) + ' voor deze behoefte</strong>'
  const rows = input.lines.map(line =>
    '<article class="product"><h2>' + esc(line.ingredientLabel) + '</h2>' +
    '<p>Benodigd: ' + esc(readablePlannerDemandAmount(line.plus.requirement.amount)) +
      ' ' + esc(line.plus.requirement.unit) + '</p>' +
    '<div class="stores"><section><h3>PLUS</h3>' + store(line.plus) +
    '</section><section><h3>DekaMarkt</h3>' + store(line.deka) +
    '</section></div><p class="difference"><strong>' +
    (line.deltaCents === 0 ? 'Beide hele-pakregels even duur' :
      esc(euro.formatCents(Math.abs(line.deltaCents))) + ' lagere hele-pakregel bij ' +
      (line.deltaCents > 0 ? 'PLUS' : 'DekaMarkt')) + '</strong></p>' +
    '<small>' + esc(privateMatchedUnitPriceGap(line.plus, line.deka)) +
      ' Eenheidsprijzen zijn indicatief en geen mandbesparing.</small></article>'
  ).join('')
  return '<!doctype html><html lang="nl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">` +
    '<title>SUPA · Mijn gefilterde winkelprijsregels</title>' +
    '<style>body{font:15px/1.5 system-ui,sans-serif;max-width:960px;margin:auto;padding:20px;color:#21382c}' +
    'h1{font-size:1.5rem}.lead{padding:12px;border-radius:10px;background:#eaf4ec}' +
    '.product{border:1px solid #c6d9cb;border-radius:12px;padding:16px;margin:16px 0;break-inside:avoid}' +
    '.product h2{font-size:1.1rem;margin:0 0 4px}.product h3{margin:0 0 7px;font-size:1rem}' +
    '.stores{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}' +
    '.stores section{display:grid;gap:4px;padding:12px;background:#f3f8f4;border-radius:8px;min-width:0;overflow-wrap:anywhere}' +
    '.stores small{display:block}.difference{margin:10px 0 4px}' +
    '@media(max-width:620px){.stores{grid-template-columns:1fr}}' +
    '@media print{body{padding:0}.product{border-color:#888}.stores section{background:#fff;border:1px solid #aaa}}</style>' +
    '</head><body><h1>SUPA · Mijn eigen winkelprijzen</h1>' +
    '<p class="lead"><strong>Gefilterde selectie, geen volledig weekmandje.</strong> ' +
    'Dit document bevat uitsluitend ' + esc(input.lines.length) + ' van ' +
      esc(input.totalOriginalLines) + ' gecontroleerde ingrediëntregels. ' +
    'Geen compleet mandtotaal, kassagarantie of onafhankelijk geverifieerde besparing.</p>' +
    '<p>Originele PLUS-bron: <time>' + esc(input.plusObservedAt) + '</time><br>' +
    'Originele DekaMarkt-bron: <time>' + esc(input.dekaObservedAt) + '</time>.</p>' +
    rows + '<p>Het hele-mandtotaal staat alleen in de oorspronkelijke, volledig ' +
    'gecontroleerde Supa-vergelijking. Gefilterde regels mogen niet als besparing ' +
    'worden opgeteld.</p></body></html>'
}
