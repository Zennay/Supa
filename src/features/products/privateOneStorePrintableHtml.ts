import type { OneStoreBasket } from '../../domain/basket.ts'
import { privateSingleStoreShoppingCsv } from '../shopping-list/privateSourceShoppingCsv.ts'
import { privatePhysicalShoppingTick } from '../shopping-list/privatePhysicalShoppingTick.ts'
import { privateUnitPrice } from '../comparison/privateUnitPrice.ts'

const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const escape = (value: string): string => value.replace(/&/gu, '&amp;')
  .replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
  .replace(/"/gu, '&quot;').replace(/'/gu, '&#39;')

/**
 * A self-contained printable basket from one complete personally reviewed
 * source. The existing CSV serializer checks the unchanged physical ledger
 * before ANY HTML is composed. No second shop or savings are inferred.
 */
export function privateOneStorePrintableHtml(input: {
  basket: OneStoreBasket
  observedAt: string
  planKey: string
  checked: Readonly<Record<string, boolean>>
  budgetCents?: number | null
}): string {
  const { basket, observedAt, planKey, checked } = input
  if (basket.store.id !== 'PLUS' && basket.store.id !== 'DekaMarkt')
    throw Error('Geen erkende eigen winkelbron.')
  const done = new Set<string>()
  for (const line of basket.lines) {
    if (line.status !== 'matched') continue
    if (checked[privatePhysicalShoppingTick(planKey, basket.store.id,
      basket.store.id, line)] === true) done.add(line.id)
  }
  // This rejects incomplete or arithmetically inconsistent baskets, untrusted
  // prices, duplicates and oversized exports before the document is offered.
  privateSingleStoreShoppingCsv({ basket, observedAt, done })
  const rows = basket.lines.map(line => {
    if (line.status !== 'matched') throw Error('Origineel product ontbreekt.')
    const isDone = done.has(line.id)
    return '<tr><td><strong>' + (isDone ? '☑ Afgevinkt' : '☐ Nog te kopen') +
      '</strong></td><th scope="row">' + escape(line.ingredientLabel) +
      '<small>' + escape(String(line.requirement.amount)) + ' ' +
      escape(line.requirement.unit) + ' nodig</small></th><td><strong>' +
      escape(line.productName) + '</strong><small>SKU ' +
      escape(line.productId) + '</small>' +
      escape(String(line.packs)) + ' hele pak(ken) · ' +
      escape(String(line.pack.count)) + ' × ' + escape(String(line.pack.amount ?? 'onbekend')) +
      ' ' + escape(line.pack.unit) + ' per pak</td><td>' +
      escape(euro.format(line.pricePerPackCents / 100)) + ' per pak<small>' +
      escape(privateUnitPrice(line) ?? 'Eenheidsprijs onbekend') +
      '</small><strong>' + escape(euro.format(line.lineTotalCents / 100)) +
      ' voor je weekvraag</strong></td></tr>'
  }).join('')
  const budgetCents = input.budgetCents
  const budget = Number.isSafeInteger(budgetCents) && budgetCents !== null &&
    budgetCents !== undefined && budgetCents >= 0
    ? '<section><h2>Mijn Planner-weekbudget</h2><p>Weekbudget: ' +
      escape(euro.format(budgetCents / 100)) + '</p><p><strong>' +
      (basket.totalCents > budgetCents
        ? escape(euro.format((basket.totalCents - budgetCents) / 100)) + ' boven budget'
        : escape(euro.format((budgetCents - basket.totalCents) / 100)) + ' binnen budget') +
      '</strong> voor je volledige originele mandje. Dit is geen kassabedrag.</p></section>'
    : ''
  const remaining = basket.lines.reduce((sum, line) =>
    line.status === 'matched' && !done.has(line.id) ? sum + line.lineTotalCents : sum, 0)
  return '<!doctype html><html lang="nl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">` +
    '<title>SUPA · Mijn ' + escape(basket.store.id) + '-weekmand</title>' +
    '<style>body{font:15px/1.5 system-ui,sans-serif;color:#20332b;max-width:1050px;margin:auto;padding:20px}' +
    'table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #d2ded7;padding:12px;text-align:left;vertical-align:top;overflow-wrap:anywhere}' +
    'small{display:block;color:#58685e}td strong{display:block}tr{break-inside:avoid}' +
    '@media(max-width:650px){table,tbody,tr,td,th{display:block}thead{display:none}tr{border-bottom:2px solid #274c35;padding:10px}td,th{border:0;padding:4px}}' +
    '@media print{body{padding:0;max-width:none}tr{break-inside:avoid}}' +
    '</style></head><body><h1>Mijn eigen ' + escape(basket.store.id) + '-weekmand</h1>' +
    '<p><strong>Origineel volledig winkelmandje: ' +
    escape(euro.format(basket.totalCents / 100)) + '</strong></p>' +
    '<p>Nog niet afgevinkte originele artikelen: ' +
    escape(euro.format(remaining / 100)) + ' aan eerder vastgelegde pakprijzen. ' +
    'Dit is geen betaalbewijs en geen actuele kassaprijs.</p>' +
    '<p><small>Eigen bronmoment: ' + escape(observedAt) + '. ' +
    'Alleen persoonlijk gecontroleerde artikelen. De andere winkelprijs is ' +
    'niet afgeleid; een prijsverschil of besparing is onbekend.</small></p>' +
    budget + '<table><thead><tr><th>Status</th><th>Ingrediënt</th><th>Origineel product</th>' +
    '<th>Hele verpakkingsprijs</th></tr></thead><tbody>' + rows +
    '</tbody></table><p><small>Alleen lokaal geaccepteerde bronregels. ' +
    'Geen kassagarantie, onafhankelijke winkelvalidatie of retailerrechten.' +
    '</small></p></body></html>'
}
