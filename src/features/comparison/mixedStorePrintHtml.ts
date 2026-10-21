import { euro as exactEuro } from '../../lib/money.ts'
import type { OneStoreBasket } from '../../domain/basket.ts'
import type { MixedStore, MixedStoreShoppingPlan } from './mixedStoreShoppingPlan.ts'
import { exportMixedStoreRouteCsv } from './mixedStoreRouteCsv.ts'
import type { OwnExtraGrocery } from './ownExtraGroceriesCsv.ts'
import type { UnpricedShoppingNote } from '../shopping-list/ManualShoppingNotes.tsx'
import { normalizePrivateNotes } from '../shopping-list/manualShoppingNotesBackup.ts'
const clean = (input: string | number) => String(input)
  .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;')

/** Print-friendly local HTML with no scripts, network requests or active
 * content. Admission uses the exact same financial/source checker as the
 * selected-route CSV, rather than trusting independently rendered totals.
 */
export function printMixedStoreRouteHtml(input: {
  plus: OneStoreBasket
  deka: OneStoreBasket
  route: MixedStoreShoppingPlan
  captured: Record<MixedStore, string>
  checked: ReadonlySet<string>
  extraVisitCostCents: number | null
  strategy: 'auto' | 'mixed' | 'single'
  extras?: readonly OwnExtraGrocery[]
  manualNotes?: readonly UnpricedShoppingNote[]
  /** Print one shop without changing the fully validated basket. */
  stop?: MixedStore
}): string {
  exportMixedStoreRouteCsv(input)
  const { route, captured, checked, stop } = input
  if (stop && !route.lines.some(line => line.store === stop))
    throw Error('Deze winkel is geen onderdeel van de gecontroleerde route.')
  if (input.extras && (input.extras.length > 100 || !input.extras.every(item =>
      typeof item.name === 'string' && item.name.length > 0 && item.name.length <= 120 &&
      Number.isFinite(item.quantity) && item.quantity > 0 && item.quantity <= 100000 &&
      ['piece', 'g', 'ml'].includes(item.unit) && typeof item.done === 'boolean')))
    throw Error('Eigen ongeprijsde boodschappen zijn niet geldig.')
  const allManual = input.manualNotes?.length
    ? normalizePrivateNotes({ schema: 'supa-private-unpriced-notes-v1',
        notes: [...input.manualNotes] }) : []
  const manual = stop
    ? allManual.filter(note => note.store === stop || note.store === 'Algemeen')
    : allManual
  const both = route.lines.some(line => line.store === 'PLUS') &&
    route.lines.some(line => line.store === 'DekaMarkt')
  const totalWithCost = !both ? BigInt(route.totalCents) : input.extraVisitCostCents === null
    ? null : BigInt(route.totalCents) + BigInt(input.extraVisitCostCents)
  const paragraphs = [
    'Originele PLUS-bron: ' + captured.PLUS,
    'Originele DekaMarkt-bron: ' + captured.DekaMarkt,
    'Gekozen strategie: ' + input.strategy,
  ]
  const storeSection = (store: MixedStore) => {
    const lines = route.lines.filter(line => line.store === store)
    return '<section><h2>' + clean(store) + ' · ' +
      clean(exactEuro.formatCents(route.totals[store])) + '</h2><ul>' +
      (lines.length === 0
        ? '<li>Geen aankopen nodig bij deze winkel.</li>'
        : lines.map(line => '<li><span class="tick">' +
          (checked.has(line.key) ? '&#9745;' : '&#9744;') +
          '</span><div><strong>' + clean(line.ingredientLabel) +
          '</strong><br><small>Benodigd: ' + clean(line.amount) + ' ' +
          clean(line.unit) + '</small><br>' +
          clean(line.packs) + ' × ' + clean(line.productName) +
          ' (broncode ' + clean(line.productId) + ')' +
          '<br><small>Per pak: ' + clean(line.packCount) + ' × ' +
          clean(line.packAmount) + ' ' + clean(line.packUnit) +
          ' · pakprijs ' + clean(exactEuro.formatCents(line.pricePerPackCents)) +
          '</small><br><b>' + clean(exactEuro.formatCents(line.lineTotalCents)) +
          '</b></div></li>').join('')) + '</ul></section>'
  }
  const extrasSection = !stop && input.extras?.length ?
    '<section><h2>Eigen extra boodschappen · winkel en prijs onbekend</h2>' +
    '<p><strong>Niet meegerekend</strong> in de berekende winkelbedragen. ' +
    'Het volledige totaal inclusief deze extra aankopen is onbekend.</p><ul>' +
    input.extras.map(item => '<li><span class="tick">' +
      (item.done ? '&#9745;' : '&#9744;') + '</span><div><strong>' +
      clean(item.name) + '</strong><br><small>' + clean(item.quantity) + ' ' +
      (item.unit === 'piece' ? 'stuks' : clean(item.unit)) +
      ' · geen gecontroleerde winkelprijs</small></div></li>').join('') +
    '</ul></section>' : ''
  const visitedStores = new Set(route.lines.map(line => line.store))
  const offRoute = manual.filter(note =>
    note.store !== 'Algemeen' && !visitedStores.has(note.store))
  const manualSection = manual.length
    ? '<section><h2>Mijn ongeprijsde boodschappen · persoonlijke herinneringen</h2>' +
      (offRoute.length ? '<p><strong>Let op:</strong> ' + offRoute.length +
        ' eigen winkelnotities horen bij een niet-gekozen winkel. Ze staan hieronder ' +
        'apart vermeld en zijn niet als stop aan deze route toegevoegd.</p>' : '') +
      '<p><strong>Bedrag onbekend.</strong> Los van alle gecontroleerde ' +
      'winkelregels, hele-verpakkingsbedragen en mogelijke prijsverschillen.</p>' +
      ['PLUS', 'DekaMarkt', 'Algemeen'].map(store => {
        const items = manual.filter(note => note.store === store)
        if (!items.length) return ''
        return '<h3>' + clean(store) + '</h3><ul>' +
          items.map(note => '<li><span class="tick">' +
            (note.done ? '&#9745;' : '&#9744;') +
            '</span><div><strong>' + clean(note.label) +
            '</strong><br><small>Zelf toegevoegd · prijs, SKU en bronmoment onbekend' +
            (note.store === 'Algemeen' && stop
              ? ' · NIET aan deze winkel toegewezen'
              : note.store !== 'Algemeen' && !visitedStores.has(note.store)
                ? ' · BUITEN gekozen winkelroute' : ' · persoonlijke lijst') +
            '</small></div></li>').join('') + '</ul>'
      }).join('') + '</section>' : ''
  const stopLines = stop ? route.lines.filter(line => line.store === stop) : []
  const stopRemaining = stopLines.filter(line => !checked.has(line.key))
    .reduce((sum, line) => sum + BigInt(line.lineTotalCents), 0n)
  // A single shop is not a complete basket or a source of savings claims.
  const summary = stop
    ? '<div class="totals"><p>Gecontroleerde pakken bij ' + clean(stop) + '<b>' +
      clean(exactEuro.formatCents(route.totals[stop])) +
      '</b></p><p>Nog niet afgevinkte pakken <b>' +
      clean(exactEuro.formatCents(stopRemaining)) +
      '</b></p></div><p>Alleen deze winkelstop, niet het volledige mandje. ' +
      'Extra bezoekkosten en eigen ongeprijsde boodschappen zijn niet meegerekend.</p>'
    : '<div class="totals"><p>PLUS hele mand <b>' +
    clean(exactEuro.formatCents(route.plusWholeCents)) + '</b></p>' +
    '<p>DekaMarkt hele mand <b>' + clean(exactEuro.formatCents(route.dekaWholeCents)) +
    '</b></p><p>Gekozen producten <b>' +
    clean(exactEuro.formatCents(route.totalCents)) + '</b></p><p>' +
    (both ? 'Zelf opgegeven extra tweede-bezoekkosten' : 'Geen tweede winkelbezoek') +
    ' <b>' + (both && input.extraVisitCostCents === null
      ? 'Niet opgegeven / onbekend'
      : clean(exactEuro.formatCents((both ? input.extraVisitCostCents : 0)!))) +
    '</b></p><p>Gekozen route met bekende extra kosten <b>' +
    (totalWithCost === null ? 'Netto totaal onbekend' :
      clean(exactEuro.formatCents(totalWithCost))) + '</b></p></div>'
  const page = '<!doctype html><html lang="nl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="referrer" content="no-referrer">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; ' +
    'style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">' +
    '<title>SUPA · mijn privé ' + (stop ? clean(stop) + ' winkelstop' : 'boodschappenroute') +
    '</title><style>' +
    'body{font:16px/1.5 system-ui,sans-serif;color:#193626;max-width:850px;' +
    'margin:1.5rem auto;padding:0 1rem}h1,h2{margin-bottom:.35rem}' +
    'header{border-bottom:2px solid #9ab59e}.warning{background:#f4f7f2;' +
    'padding:1rem;border-left:4px solid #366c43}' +
    '.meta{font-size:.9rem;overflow-wrap:anywhere}.totals{display:grid;' +
    'grid-template-columns:repeat(2,minmax(0,1fr));gap:.4rem}' +
    '.totals p{margin:.25rem 0;padding:.6rem;border:1px solid #d6e3d7}' +
    '.totals b{display:block;font-size:1.15rem}section{margin-top:1.3rem}' +
    'ul{padding:0;list-style:none}li{display:flex;gap:.8rem;padding:.7rem 0;' +
    'border-bottom:1px solid #d7ded6;break-inside:avoid}li div{min-width:0;' +
    'overflow-wrap:anywhere}.tick{font-size:1.7rem}small{color:#576a59}' +
    '@media(max-width:650px){.totals{grid-template-columns:1fr}}' +
    '@media print{body{max-width:none;margin:0;font-size:11pt}' +
    'header,section{break-inside:avoid}.warning{border:1px solid #777}}' +
    '</style></head><body><header><h1>SUPA · mijn eigen ' +
    (stop ? clean(stop) + '-winkelstop' : 'boodschappenroute') + '</h1>' +
    '<p class="warning"><strong>Privé rekenhulp.</strong> Geen onafhankelijke ' +
    'retailerprijzen, bronrechten, kassa- of besparingsgarantie. ' +
    'Je hebt deze originele bronproducten persoonlijk gecontroleerd. ' +
    'Dit bestand bevat geen scripts of internetbronnen.</p></header>' +
    '<div class="meta">' + paragraphs.map(item =>
      '<p>' + clean(item) + '</p>').join('') + '</div>' + summary +
    (stop ? storeSection(stop) : storeSection('PLUS') + storeSection('DekaMarkt')) +
    extrasSection + manualSection +
    '<footer><p>Handmatige winkelkeuzes en afvinkingen zijn uitsluitend voor ' +
    'je eigen boodschappen. Verouderde prijsopnames kunnen andere actuele ' +
    'winkelprijzen hebben. Print via je browser.</p></footer></body></html>'
  if (new TextEncoder().encode(page).byteLength > 256_000)
    throw Error('Deze privéwinkelroute is te groot om als HTML op te slaan.')
  return page
}
