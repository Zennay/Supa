import type { OwnStoreWeekComparison } from '../planner/ownStoreBudgetComparison.ts'
import { privateUnitPrice } from '../comparison/privateUnitPrice.ts'

type Comparable = Extract<OwnStoreWeekComparison, { status: 'comparable' }>
const money = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

// Print only the canonical, fully paired physical week basket. Never
// reinterpret missing/expired own captures as a zero-euro price.
export function privateTwoStorePrintableHtml(
  comparison: Comparable,
  moments: { PLUS: string; DekaMarkt: string },
): string {
  const esc = (value: string): string => value.replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;').replace(/'/gu, '&#39;')
  const euro = (cents: number): string => esc(money.format(cents / 100))
  const entry = (line: Comparable['lines'][number]['plus']): string =>
    '<strong>' + esc(line.productName) + '</strong><br>' +
    '<small>SKU ' + esc(line.productId) + '</small><br>' +
    esc(String(line.packs)) + ' hele pak(ken) · ' +
    esc(String(line.pack.count)) + ' × ' + esc(String(line.pack.amount)) +
    ' ' + esc(line.pack.unit) + ' per pak<br>' +
    euro(line.pricePerPackCents) + ' per pak · ' +
    esc(privateUnitPrice(line) ?? 'Eenheidsprijs onbekend') +
    '<br><strong>' + euro(line.lineTotalCents) + ' voor de week</strong>'
  const lines = comparison.lines.map(line =>
    '<tr><th scope="row">' + esc(line.ingredientLabel) +
    '<small>' + esc(String(line.plus.requirement.amount)) + ' ' +
    esc(line.plus.requirement.unit) + ' nodig</small></th><td>' +
    entry(line.plus) + '</td><td>' + entry(line.deka) +
    '</td><td>' + (line.deltaCents === 0 ? 'Gelijk' :
      euro(Math.abs(line.deltaCents)) + ' lager bij ' +
      (line.deltaCents > 0 ? 'PLUS' : 'DekaMarkt')) +
    '</td></tr>').join('')
  const winner = comparison.cheapest
    ? comparison.cheapest + ' is ' + money.format(comparison.differenceCents / 100) +
      ' goedkoper voor het volledige mandje met hele verpakkingen.'
    : 'Beide complete mandjes hebben dezelfde prijs.'
  const route = comparison.mixedRoute
  const extra = route
    ? '<section><h2>Zelfgekozen combinatie</h2><p>Laagste productkosten bij ' +
      'selectie per ingrediënt: <strong>' + euro(route.totalCents) +
      '</strong>. Productverschil tegenover de goedkoopste complete winkel: ' +
      euro(route.possibleProductDifferenceCents) + '.</p><p>' +
      (route.requiresTwoStops
        ? 'Twee winkels nodig; bezoekkosten en tijd zijn onbekend. Geen netto besparingsclaim.'
        : 'Voor deze combinatie is geen tweede winkelstop nodig.') +
      '</p></section>'
    : ''
  return '<!doctype html><html lang="nl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">` +
    '<title>SUPA · Privé twee-winkelweekmand</title><style>' +
    'body{font:15px/1.5 system-ui,sans-serif;max-width:1100px;padding:24px;margin:auto;color:#21352d}' +
    'table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ccd9d1;text-align:left;padding:12px;vertical-align:top;overflow-wrap:anywhere}' +
    'th{min-width:120px}th small{display:block;font-weight:normal}td{width:28%}small{color:#56695e}' +
    'section{margin:24px 0}h1,h2{line-height:1.2}@media(max-width:700px){body{padding:12px}' +
    'table,tbody,tr,th,td{display:block}thead{display:none}tr{padding:16px 0;border-bottom:2px solid #21352d}' +
    'td{width:auto;padding:4px 12px;border:0}td:before{display:block;font-weight:bold;color:#56695e}' +
    'td:nth-child(2):before{content:"PLUS"}td:nth-child(3):before{content:"DekaMarkt"}' +
    'td:nth-child(4):before{content:"Prijsverschil"}}' +
    '@media print{body{max-width:none;padding:0}tr{break-inside:avoid}section{break-inside:avoid}}' +
    '</style></head><body><h1>Mijn persoonlijke twee-winkelweekmand</h1>' +
    '<p>Alleen eigen lokaal gecontroleerde bronartikelen, geen openbare of actuele winkelprijsclaim. ' +
    'Geen kassagarantie of onafhankelijk aangetoonde besparing.</p>' +
    '<section><h2>Volledige mandjes</h2><p>PLUS: <strong>' + euro(comparison.plusCents) +
    '</strong> · DekaMarkt: <strong>' + euro(comparison.dekaCents) + '</strong></p>' +
    '<p><strong>' + esc(winner) + '</strong></p>' +
    '<p><small>Eigen PLUS-bronmoment: ' + esc(moments.PLUS) +
    '<br>Eigen DekaMarkt-bronmoment: ' + esc(moments.DekaMarkt) +
    '</small></p></section><section><h2>Dezelfde fysieke weekvraag per ingrediënt</h2>' +
    '<table><thead><tr><th>Ingrediënt</th><th>PLUS</th><th>DekaMarkt</th>' +
    '<th>Hele-pakverschil</th></tr></thead><tbody>' + lines + '</tbody></table></section>' +
    extra + '<p><small>Volledige eigen bronmomenten moeten binnen 24 uur vallen en ' +
    'een identieke fysieke weekvraag bevatten. Alle bedragen zijn oorspronkelijke ' +
    'hele-verpakkingsprijzen. Geen live bronrechten of netto winkelreisbesparing afgeleid.</small></p>' +
    '</body></html>'
}
