import type { PrivateCaptureProgress, PrivateReviewedBaskets } from '../comparison/privateReviewedBasketBridge.ts'
import { privateKnownPricePairs, privateProgressProductRows, formatKnownUnitGap } from './privateProgressProductRows.ts'
import { readablePlannerDemandAmount } from '../comparison/plannerPriceCaptureGuide.ts'

const money = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const esc = (value: string): string => value.replace(/&/gu, '&amp;')
  .replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
  .replace(/"/gu, '&quot;').replace(/'/gu, '&#39;')

/** Scriptless local printout of original paired, personally reviewed lines.
 * Missing sources never become a full basket, winner or zero-euro price. */
export function privateKnownLinePricePrintHtml(
  progress: PrivateCaptureProgress | null,
  reviewed: PrivateReviewedBaskets | null,
  now: number,
): string {
  const pairs = privateKnownPricePairs(progress, reviewed, now)
  const needs = new Map(privateProgressProductRows(progress, now).map(row =>
    [row.line.ingredientId, row.line]))
  if (!pairs.length) throw Error('Geen actuele vergelijkbare twee-winkel-ingrediënten.')
  const lines = pairs.map(pair => {
    const original = needs.get(pair.ingredientId)
    if (!original) throw Error('De oorspronkelijke fysieke vraag is gewijzigd.')
    const difference = pair.difference === 0 ? 'Gelijke hele-pakprijs' :
      money.format(Math.abs(pair.difference) / 100) + ' lager bij ' +
      (pair.difference > 0 ? 'PLUS' : 'DekaMarkt')
    return '<tr><th scope="row">' + esc(original.ingredientLabel) +
      '<small>PLUS ' + esc(readablePlannerDemandAmount(pair.plusRequiredAmount)) +
      ' ' + esc(pair.plusRequiredUnit) + ' = DekaMarkt ' +
      esc(readablePlannerDemandAmount(pair.dekaRequiredAmount)) + ' ' +
      esc(pair.dekaRequiredUnit) + ' nodig (zelfde fysieke hoeveelheid)</small></th>' +
      '<td><b>' + esc(pair.plusProduct.productName) + '</b>' +
      '<small>SKU ' + esc(pair.plusProduct.productId) + ' · pak ' +
      esc(String(pair.plusProduct.packCount)) + ' × ' +
      esc(String(pair.plusProduct.packAmount)) + ' ' + esc(pair.plusProduct.packUnit) +
      ' · ' + esc(pair.plusProduct.unitRate ?? 'eenheidsprijs onbekend') +
      '</small><strong>' + esc(money.format(pair.plusCents / 100)) +
      '</strong><small>' + esc(String(pair.plusPacks)) + ' hele pakken · ' +
      esc(pair.plusObservedAt) + '</small></td>' +
      '<td><b>' + esc(pair.dekaProduct.productName) + '</b>' +
      '<small>SKU ' + esc(pair.dekaProduct.productId) + ' · pak ' +
      esc(String(pair.dekaProduct.packCount)) + ' × ' +
      esc(String(pair.dekaProduct.packAmount)) + ' ' + esc(pair.dekaProduct.packUnit) +
      ' · ' + esc(pair.dekaProduct.unitRate ?? 'eenheidsprijs onbekend') +
      '</small><strong>' + esc(money.format(pair.dekaCents / 100)) +
      '</strong><small>' + esc(String(pair.dekaPacks)) + ' hele pakken · ' +
      esc(pair.dekaObservedAt) + '</small></td>' +
      '<td><strong>' + esc(difference) + '</strong><small>' +
      esc(formatKnownUnitGap(pair.unitGap)) +
      '</small><small>Eenheidsprijs is indicatief; hele pakken bepalen regelprijs.</small></td></tr>'
  }).join('')
  const html = '<!doctype html><html lang="nl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">` +
    '<title>Supa · Eigen winkelproductprijzen</title><style>' +
    'body{font:16px/1.5 system-ui,sans-serif;max-width:1000px;margin:auto;padding:20px;color:#243b32}' +
    'table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #cad9cd;text-align:left;padding:12px;vertical-align:top;overflow-wrap:anywhere}' +
    'small{display:block;font-weight:normal;color:#5b7263}.note{border:1px solid #cad9cd;padding:14px;border-radius:8px}' +
    '@media(max-width:700px){table,tbody,tr,th,td{display:block}thead{display:none}tr{padding:12px 0;border-bottom:2px solid #cad9cd}th,td{border:0;padding:3px}}' +
    '@media print{body{max-width:none;padding:0}tr{break-inside:avoid}}' +
    '</style></head><body><h1>Mijn bekende PLUS/DekaMarkt-prijsregels</h1>' +
    '<p class="note"><strong>Geen volledige weekmandprijs:</strong> alleen ' +
    'individueel gepaarde, gecontroleerde eigen producten. Ontbrekende ' +
    'producten zijn onbekend, nooit € 0. Geen kassagarantie, winkelwinnaar of ' +
    'onafhankelijk bewezen besparing.</p><p>Zelfde oorspronkelijke fysieke ' +
    'ingrediëntbehoefte, bronmomenten binnen 24 uur. Geen publieke winkelcatalogus.</p>' +
    '<table><thead><tr><th>Ingrediënt</th><th>PLUS</th><th>DekaMarkt</th>' +
    '<th>Alleen dit ingrediënt</th></tr></thead><tbody>' + lines +
    '</tbody></table><small>Privé offline afdruk zonder scripts, externe beelden of netwerk.</small>' +
    '</body></html>'
  if (new TextEncoder().encode(html).length > 256_000)
    throw Error('De eigen twee-winkel-afdruk is te groot.')
  return html
}

export function downloadPrivateKnownLinePricePrint(
  progress: PrivateCaptureProgress | null,
  reviewed: PrivateReviewedBaskets | null,
): void {
  const html = privateKnownLinePricePrintHtml(progress, reviewed, Date.now())
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = 'supa-eigen-bekende-plus-deka-regelprijzen.html'
    document.body.append(link)
    try { link.click() } finally { link.remove() }
  } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
