import type { OwnStoreWeekComparison } from '../planner/ownStoreBudgetComparison.ts'
import { privateUnitPrice } from '../comparison/privateUnitPrice.ts'
import { readablePlannerDemandAmount } from '../comparison/plannerPriceCaptureGuide.ts'
import { privatePhysicalShoppingTick } from '../shopping-list/privatePhysicalShoppingTick.ts'

type Comparable = Extract<OwnStoreWeekComparison, { status: 'comparable' }>
const money = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

// Print only the canonical, fully paired physical week basket. Never
// reinterpret missing/expired own captures as a zero-euro price.
export function privateTwoStorePrintableHtml(
  comparison: Comparable,
  moments: { PLUS: string; DekaMarkt: string },
  shopping: {
    planKey: string
    storeIds: { PLUS: string; DekaMarkt: string }
    checked: Readonly<Record<string, boolean>>
  },
  budgetCents: number | null = null,
): string {
  const esc = (value: string): string => value.replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;').replace(/'/gu, '&#39;')
  const euro = (cents: number): string => esc(money.format(cents / 100))
  const entry = (shop: 'PLUS' | 'DekaMarkt',
    line: Comparable['lines'][number]['plus']): string => {
    const checked = shopping.checked[
      privatePhysicalShoppingTick(shopping.planKey, shop, shopping.storeIds[shop], line)
    ] === true
    return '<span class="tick">' + (checked ? '☑ Afgevinkt' : '☐ Nog te kopen') +
      '</span><br><strong>' + esc(line.productName) + '</strong><br>' +
    '<small>SKU ' + esc(line.productId) + '</small><br>' +
    esc(String(line.packs)) + ' hele pak(ken) · ' +
    esc(String(line.pack.count)) + ' × ' + esc(readablePlannerDemandAmount(line.pack.amount)) +
    ' ' + esc(line.pack.unit) + ' per pak<br>' +
    euro(line.pricePerPackCents) + ' per pak · ' +
    esc(privateUnitPrice(line) ?? 'Eenheidsprijs onbekend') +
    '<br><strong>' + euro(line.lineTotalCents) + ' voor de week</strong>'
  }
  const lines = comparison.lines.map(line =>
    '<tr><th scope="row">' + esc(line.ingredientLabel) +
    '<small>Benodigd: PLUS ' +
    esc(readablePlannerDemandAmount(line.plus.requirement.amount)) + ' ' +
    esc(line.plus.requirement.unit) + ' = DekaMarkt ' +
    esc(readablePlannerDemandAmount(line.deka.requirement.amount)) + ' ' +
    esc(line.deka.requirement.unit) + '</small></th><td>' +
    entry('PLUS', line.plus) + '</td><td>' + entry('DekaMarkt', line.deka) +
    '</td><td>' + (line.deltaCents === 0 ? 'Gelijk' :
      euro(Math.abs(line.deltaCents)) + ' lager bij ' +
      (line.deltaCents > 0 ? 'PLUS' : 'DekaMarkt')) +
    '</td></tr>').join('')
  const winner = comparison.cheapest
    ? comparison.cheapest + ' is ' + money.format(comparison.differenceCents / 100) +
      ' goedkoper voor het volledige mandje met hele verpakkingen.'
    : 'Beide complete mandjes hebben dezelfde prijs.'
  // Reconcile all whole-pack line deltas, not a filtered screen subset.
  const plusGross = comparison.lines.reduce((sum, line) =>
    sum + Math.max(0, line.deltaCents), 0)
  const dekaGross = comparison.lines.reduce((sum, line) =>
    sum + Math.max(0, -line.deltaCents), 0)
  const plusLower = comparison.lines.filter(line => line.deltaCents > 0).length
  const dekaLower = comparison.lines.filter(line => line.deltaCents < 0).length
  const equal = comparison.lines.length - plusLower - dekaLower
  const drivers = [...comparison.lines].filter(line => line.deltaCents !== 0)
    .sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents))
    .slice(0, 5)
  const explanation = '<section><h2>Waarom verschillen de volledige mandjes?</h2>' +
    '<p>PLUS: ' + plusLower + ' ingrediënten lager in hele-pakprijs (' +
    euro(plusGross) + ' samen). DekaMarkt: ' + dekaLower +
    ' ingrediënten lager (' + euro(dekaGross) + ' samen). ' +
    equal + ' ingrediënten kosten evenveel.</p>' +
    '<p>Na verrekening is het volledige rekenkundige prijsverschil ' +
    '<strong>' + euro(Math.abs(plusGross - dekaGross)) +
    '</strong>. Een lager bedrag per kilo is niet automatisch een lager bedrag ' +
    'voor alle benodigde hele verpakkingen.</p>' +
    (drivers.length ? '<h3>Grootste vijf regelverschillen</h3><ol>' +
      drivers.map(line => '<li>' + esc(line.ingredientLabel) + ': ' +
        euro(Math.abs(line.deltaCents)) + ' lager bij ' +
        (line.deltaCents > 0 ? 'PLUS' : 'DekaMarkt') + '</li>').join('') +
      '</ol>' : '<p>Geen prijsverschillen per ingrediënt.</p>') +
    '<small>Alleen oorspronkelijke persoonlijk gecontroleerde winkelopnames, ' +
    'geen actuele prijs of onafhankelijke besparingsclaim.</small></section>'
  const budget = Number.isSafeInteger(budgetCents) && budgetCents !== null &&
    budgetCents >= 0
    ? '<section><h2>Planner-weekbudget</h2><p>Ingesteld: ' +
      euro(budgetCents) + '</p><p>PLUS: ' +
      (comparison.plusCents > budgetCents
        ? euro(comparison.plusCents - budgetCents) + ' boven budget'
        : euro(budgetCents - comparison.plusCents) + ' binnen budget') +
      ' · DekaMarkt: ' +
      (comparison.dekaCents > budgetCents
        ? euro(comparison.dekaCents - budgetCents) + ' boven budget'
        : euro(budgetCents - comparison.dekaCents) + ' binnen budget') +
      '.</p><small>Alleen het complete oorspronkelijke weekmandje; niet je '
      + 'afgevinkte aankopen of werkelijk kassabedrag.</small></section>'
    : ''
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
    '.tick{display:inline-block;border:1px solid #adbfb0;padding:2px 7px;border-radius:6px;margin-bottom:6px;font-weight:bold}' +
    'section{margin:24px 0}h1,h2{line-height:1.2}@media(max-width:700px){body{padding:12px}' +
    'table,tbody,tr,th,td{display:block}thead{display:none}tr{padding:16px 0;border-bottom:2px solid #21352d}' +
    'td{width:auto;padding:4px 12px;border:0}td:before{display:block;font-weight:bold;color:#56695e}' +
    'td:nth-child(2):before{content:"PLUS"}td:nth-child(3):before{content:"DekaMarkt"}' +
    'td:nth-child(4):before{content:"Prijsverschil"}}' +
    '@media print{body{max-width:none;padding:0}tr{break-inside:avoid}section{break-inside:avoid}}' +
    '</style></head><body><h1>Mijn persoonlijke twee-winkelweekmand</h1>' +
    '<p>De afvinkstatus is jouw momentopname van de eigen boodschappenlijst. ' +
    'Afvinken is geen bewijs van betaling of prijscontrole.</p>' +
    '<p>Alleen eigen lokaal gecontroleerde bronartikelen, geen openbare of actuele winkelprijsclaim. ' +
    'Geen kassagarantie of onafhankelijk aangetoonde besparing.</p>' +
    '<section><h2>Volledige mandjes</h2><p>PLUS: <strong>' + euro(comparison.plusCents) +
    '</strong> · DekaMarkt: <strong>' + euro(comparison.dekaCents) + '</strong></p>' +
    '<p><strong>' + esc(winner) + '</strong></p>' +
    '<p><small>Eigen PLUS-bronmoment: ' + esc(moments.PLUS) +
    '<br>Eigen DekaMarkt-bronmoment: ' + esc(moments.DekaMarkt) +
    '</small></p></section>' + budget + explanation +
    '<section><h2>Dezelfde fysieke weekvraag per ingrediënt</h2>' +
    '<table><thead><tr><th>Ingrediënt</th><th>PLUS</th><th>DekaMarkt</th>' +
    '<th>Hele-pakverschil</th></tr></thead><tbody>' + lines + '</tbody></table></section>' +
    extra + '<p><small>Volledige eigen bronmomenten moeten binnen 24 uur vallen en ' +
    'een identieke fysieke weekvraag bevatten. Alle bedragen zijn oorspronkelijke ' +
    'hele-verpakkingsprijzen. Geen live bronrechten of netto winkelreisbesparing afgeleid.</small></p>' +
    '</body></html>'
}
