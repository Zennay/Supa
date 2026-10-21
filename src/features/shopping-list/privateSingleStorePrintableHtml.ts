import { euro as exactEuro } from '../../lib/money.ts'
import type { OneStoreBasket } from '../../domain/basket.ts'
import { privateSingleStoreShoppingCsv } from './privateSourceShoppingCsv.ts'
import { privateUnitPrice } from '../comparison/privateUnitPrice.ts'
import { readablePlannerDemandAmount } from '../comparison/plannerPriceCaptureGuide.ts'
import type { OwnExtraGrocery } from '../comparison/ownExtraGroceriesCsv.ts'
import type { UnpricedShoppingNote } from './ManualShoppingNotes.tsx'
import { normalizePrivateNotes } from './manualShoppingNotesBackup.ts'

const esc = (value: string | number) => String(value)
  .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;')

/** Inert, offline one-shop checklist for user-admitted current source observations.
 * Share/print is user-initiated; this HTML cannot import new retailer evidence.
 */
export function privateSingleStorePrintableHtml({ basket, observedAt, done, extras, manualNotes }: {
  basket: OneStoreBasket; observedAt: string; done: ReadonlySet<string>
  extras?: readonly OwnExtraGrocery[]
  manualNotes?: readonly UnpricedShoppingNote[]
}): string {
  // Reuse the exact existing CSV financial/physical admission instead of
  // letting printable output become a weaker independent price renderer.
  privateSingleStoreShoppingCsv({ basket, observedAt, done })
  const stillNeeded = basket.lines.reduce((sum, line) => sum +
    (line.status === 'matched' && !done.has(line.id) ? line.lineTotalCents : 0), 0)
  if (!Number.isSafeInteger(stillNeeded)) throw Error('Ongeldig resterend mandtotaal.')
  const items = basket.lines.map(line => {
    if (line.status !== 'matched') throw Error('Niet alle bronartikelen zijn gecontroleerd.')
    return '<li><span class="tick">' + (done.has(line.id) ? '&#9745;' : '&#9744;') +
      '</span><div><strong>' + esc(line.ingredientLabel) + '</strong>' +
      '<p>' + esc(line.packs) + ' × ' + esc(line.productName) +
      ' <small>SKU ' + esc(line.productId) + '</small></p>' +
      '<small>Benodigd: ' + esc(readablePlannerDemandAmount(line.requirement.amount)) +
      ' ' + esc(line.requirement.unit) + '<br>Verpakking: ' + esc(line.pack.count) +
      ' × ' + esc(readablePlannerDemandAmount(line.pack.amount)) +
      ' ' + esc(line.pack.unit) + ' · ' +
      esc(exactEuro.formatCents(line.pricePerPackCents)) + ' per pak · ' +
      esc(privateUnitPrice(line) ?? 'eenheidsprijs onbekend') + '</small></div>' +
      '<b>' + esc(exactEuro.formatCents(line.lineTotalCents)) + '</b></li>'
  }).join('')
  if (extras && (extras.length > 100 || !extras.every(item =>
      typeof item.name === 'string' && item.name.length > 0 && item.name.length <= 120 &&
      Number.isFinite(item.quantity) && item.quantity > 0 && item.quantity <= 100000 &&
      ['piece', 'g', 'ml'].includes(item.unit) && typeof item.done === 'boolean')))
    throw Error('Extra boodschappen zijn niet geldig voor deze afdruk.')
  const extrasHtml = extras?.length
    ? '<section><h2>Eigen extra boodschappen · winkelprijs onbekend</h2><p>Deze ' +
      extras.length + ' extra artikelen hebben geen gecontroleerde productprijs en ' +
      'vallen buiten alle bovenstaande eurobedragen. Het echte eindtotaal is onbekend.</p><ul>' +
      extras.map(item => '<li><span class="tick">' + (item.done ? '&#9745;' : '&#9744;') +
        '</span><div><strong>' + esc(item.name) + '</strong><br><small>' +
        esc(item.quantity) + ' ' + (item.unit === 'piece' ? 'stuks' : esc(item.unit)) +
        ' · prijs onbekend</small></div></li>').join('') + '</ul></section>'
    : ''
  const checkedNotes = manualNotes ? normalizePrivateNotes({
    schema: 'supa-private-unpriced-notes-v1', notes: manualNotes,
  }).filter(note => note.store === 'Algemeen' || note.store === basket.store.id) : []
  const manualHtml = checkedNotes.length
    ? '<section><h2>Zelf toegevoegde boodschappen · prijs onbekend</h2>' +
      '<p>Deze ' + checkedNotes.length + ' handmatig ingevoerde artikelen zijn ' +
      'niet in de originele winkelprijs of besparing opgenomen.</p><ul>' +
      checkedNotes.map(note => '<li><span class="tick">' +
        (note.done ? '&#9745;' : '&#9744;') + '</span><div><strong>' +
        esc(note.label) + '</strong><br><small>Mijn ' + esc(note.store) +
        '-notitie · geen winkelprijs of productcode</small></div></li>').join('') +
      '</ul></section>' : ''
  const html = '<!doctype html><html lang="nl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="referrer" content="no-referrer">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; ' +
    'style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">' +
    '<title>Supa · eigen boodschappenlijst</title><style>' +
    'body{font:16px/1.5 system-ui,sans-serif;color:#193626;max-width:820px;' +
    'margin:1rem auto;padding:1rem}header{border-bottom:2px solid #92af9b}' +
    '.notice{background:#f1f6f0;padding:1rem;border-left:4px solid #376848}' +
    '.totals{display:grid;grid-template-columns:repeat(2,1fr);gap:1rem;margin:1rem 0}' +
    '.totals p{border:1px solid #c9d8c9;padding:.8rem}.totals strong{display:block}' +
    'ul{list-style:none;padding:0}li{display:flex;gap:1rem;border-bottom:1px solid #d5ded5;' +
    'padding:.8rem 0;break-inside:avoid}li div{flex:1;min-width:0;overflow-wrap:anywhere}' +
    'li p{margin:.2rem 0}.tick{font-size:1.7rem}small{color:#516654}' +
    '@media(max-width:540px){.totals{grid-template-columns:1fr}}' +
    '@media print{body{font-size:11pt;max-width:none;margin:0}header{break-after:avoid}}' +
    '</style></head><body><header><h1>Supa · ' + esc(basket.store.id) +
    ' boodschappenlijst</h1><p>Eigen gecontroleerde winkelbron: <strong>' +
    esc(observedAt) + '</strong></p><p class="notice">Privé rekenhulp, geen actuele ' +
    'kassa-/beschikbaarheidsgarantie, bronlicentie of onafhankelijke besparingsclaim. ' +
    'Dit bestand werkt offline zonder scripts of netwerkverbinding.</p></header>' +
    '<section class="totals"><p>Alle hele verpakkingen<strong>' +
    esc(exactEuro.formatCents(basket.totalCents)) + '</strong></p>' +
    '<p>Nog op de lijst (niet-afgevinkt)<strong>' + esc(exactEuro.formatCents(stillNeeded)) +
    '</strong></p></section><main><h2>Artikelen</h2><ul>' + items +
    '</ul></main>' + extrasHtml + manualHtml + '<footer><p>Afgevinkt betekent niet betaald. Controleer de originele ' +
    'winkelprijzen opnieuw bij een volgende boodschappenronde. Print met je browser.</p>' +
    '</footer></body></html>'
  if (new TextEncoder().encode(html).length > 256_000)
    throw Error('Winkelmand te groot voor afdrukken.')
  return html
}
