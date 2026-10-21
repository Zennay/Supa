import { euro } from '../../lib/money.ts'

export type PrivateDraftReviewLine = {
  ingredient: string
  demand: string
  plus: { code: string; product: string; packs: number; packCents: number; totalCents: number; unitRate: string | null }
  deka: { code: string; product: string; packs: number; packCents: number; totalCents: number; unitRate: string | null }
}

export type PrivateDraftUnpairedLine = {
  ingredient: string
  demand: string
  plusStatus: string
  dekaStatus: string
  plus?: PrivateDraftReviewLine['plus']
  deka?: PrivateDraftReviewLine['deka']
}

const escapeHtml = (input: string): string => input
  .replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
  .replace(/"/gu, '&quot;').replace(/'/gu, '&#39;')

/**
 * A script-free, local comparison WORKSHEET for personally entered drafts.
 * Never a source receipt, authorised retailer feed or verified basket result.
 * The caller is responsible for checking timestamps and original pack math.
 */
export function privateDraftReviewHtml(
  lines: readonly PrivateDraftReviewLine[],
  capturedAt: { PLUS: string; DekaMarkt: string },
  totalPhysicalNeeds: number,
  unpaired: readonly PrivateDraftUnpairedLine[],
  pairEligible: boolean,
): string {
  const observedStatuses = new Set([
    'Zelf gecontroleerd niet beschikbaar', 'Verpakking past niet bij de vraag',
    'Oorspronkelijke productcode conflicteert met andere winkelregel',
  ])
  const hasActualOwnInput = lines.length > 0 || unpaired.some(item =>
    item.plus || item.deka || observedStatuses.has(item.plusStatus) ||
    observedStatuses.has(item.dekaStatus))
  if (!hasActualOwnInput || lines.length > 1000 ||
      (lines.length > 0 && !pairEligible) ||
      !Number.isSafeInteger(totalPhysicalNeeds) ||
      lines.length + unpaired.length !== totalPhysicalNeeds ||
      unpaired.some(line => !line.ingredient.trim() || !line.demand.trim() ||
        !line.plusStatus.trim() || !line.dekaStatus.trim() ||
        [line.plus, line.deka].some(item => item && (!item.code.trim() ||
          !item.product.trim() || !Number.isSafeInteger(item.packs) ||
          item.packs <= 0 || !Number.isSafeInteger(item.packCents) ||
          item.packCents < 0 || !Number.isSafeInteger(item.totalCents) ||
          item.totalCents !== item.packs * item.packCents))) ||
      lines.some(line => !line.ingredient.trim() || !line.demand.trim() ||
        [line.plus, line.deka].some(item => !item.code.trim() || !item.product.trim() ||
          !Number.isSafeInteger(item.packs) || item.packs <= 0 ||
          !Number.isSafeInteger(item.packCents) || item.packCents < 0 ||
          !Number.isSafeInteger(item.totalCents) ||
          item.totalCents !== item.packs * item.packCents))) {
    throw Error('Onvolledig of inconsistent privéconcept; afdruk geweigerd.')
  }

  const renderStore = (store: 'PLUS' | 'DekaMarkt', item: PrivateDraftReviewLine['plus']) =>
    '<div class="shop"><b>' + store + '</b>' +
      '<p>Originele code: ' + escapeHtml(item.code) + '</p>' +
      '<p>Eigen productkeuze: ' + escapeHtml(item.product) + '</p>' +
      '<p>' + item.packs + ' hele pakken × ' + euro.formatCents(item.packCents) +
      ' = <b>' + euro.formatCents(item.totalCents) + '</b></p>' +
      '<p>Indicatieve eenheidsprijs: ' + escapeHtml(item.unitRate ?? 'onbekend') + '</p></div>'

  const sections = lines.map((line, index) => {
    const difference = line.deka.totalCents - line.plus.totalCents
    if (!Number.isSafeInteger(difference)) throw Error('Prijsverschil buiten veilige centgrens.')
    return '<section><h2>' + (index + 1) + '. ' + escapeHtml(line.ingredient) + '</h2>' +
      '<p>Exact dezelfde Planner-vraag: ' + escapeHtml(line.demand) + '</p>' +
      '<div class="shops">' + renderStore('PLUS', line.plus) + renderStore('DekaMarkt', line.deka) + '</div>' +
      '<p class="notice">' + (difference === 0 ? 'Gelijke voorlopige regelberekening.' :
        euro.formatCents(Math.abs(difference)) + ' rekenverschil op deze ongetoetste regel.') +
      ' Controleer of het écht hetzelfde product is; geen winkeladvies.</p></section>'
  }).join('')

  const missing = unpaired.length
    ? '<section><h2>Niet als twee prijsregels vergelijkbaar</h2>' +
      '<p>Geen prijsverschil of winkelwinnaar op deze regels. Hieronder kunnen ' +
      'alleen persoonlijk ingevoerde losse pakberekeningen staan, ook als ' +
      'de andere winkel nog geen geldige opname heeft. Expliciet niet beschikbaar ' +
      'is iets anders dan onbekend.</p>' +
      '<ul class="unpaired">' + unpaired.map(line => {
        const captures = [
          line.plus ? renderStore('PLUS', line.plus) : '',
          line.deka ? renderStore('DekaMarkt', line.deka) : '',
        ].join('')
        return '<li><strong>' + escapeHtml(line.ingredient) + '</strong> · ' +
          escapeHtml(line.demand) + '<br>PLUS: ' + escapeHtml(line.plusStatus) +
          ' · DekaMarkt: ' + escapeHtml(line.dekaStatus) +
          (captures ? '<div class="shops">' + captures + '</div>' : '') +
          '</li>'
      }).join('') + '</ul></section>'
    : ''

  const html = '<!doctype html><html lang="nl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">' +
    '<title>SUPA · Privé conceptcontrole twee winkels</title>' +
    '<style>body{max-width:900px;margin:auto;padding:1.5rem;color:#203126;font:16px/1.5 system-ui,sans-serif}' +
    'section{margin:1rem 0;padding:1rem 0;border-top:2px solid #d2dcd1;break-inside:avoid}' +
    '.shops{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:1rem}' +
    '.shop{padding:.8rem;border:1px solid #c4d4c7;border-radius:9px;overflow-wrap:anywhere}' +
    '.shop p{margin:.35rem 0}.notice{background:#f7f5e7;padding:.65rem;overflow-wrap:anywhere}' +
    '.unpaired{padding-left:1.5rem}.unpaired li{margin:1rem 0;break-inside:avoid}' +
    'header{border-bottom:2px solid #658c74;padding-bottom:1rem}small{color:#526457}' +
    '@media print{body{padding:0}section{break-inside:avoid}}</style></head><body>' +
    '<header><h1>Mijn lokale PLUS/Deka-prijsconcepten</h1>' +
    '<p><strong>ALLEEN PRIVÉWERKBLAD — NIET GEVERIFIEERD</strong></p>' +
    '<p>PLUS: ' + escapeHtml(capturedAt.PLUS || 'bronmoment onbekend / niet geselecteerd') +
    ' · DekaMarkt: ' + escapeHtml(capturedAt.DekaMarkt || 'bronmoment onbekend / niet geselecteerd') +
    ' (eigen invoer)</p>' +
    '<p>' + lines.length + ' van ' + totalPhysicalNeeds +
    ' fysieke Planner-behoeften met twee voorlopige pakberekeningen.</p>' +
    '<p class="notice">' + (pairEligible
      ? 'De twee ingevoerde bronmomenten liggen voorlopig binnen 24 uur en zeven dagen; SKU- en productreviews zijn nog verplicht.'
      : 'Er is geen bruikbaar paar van twee actuele, maximaal 24 uur gescheiden bronmomenten. Daarom zijn uitsluitend losse persoonlijke productprijzen zichtbaar en is ieder prijsverschil verborgen.') +
    '</p>' +
    '<p>Ontbrekende of ongeschikte producten blijven onbekend. Geen volledig mandtotaal, ' +
    'geen bevestigde SKU-equivalentie, geen actuele retailerrechten en geen bewezen besparing. ' +
    'Vervolg in de echte Supa bron-/productreview.</p></header>' + sections + missing +
    '<footer><small>Offlinerapport zonder scripts of externe bronnen. Originele winkelcodes ' +
    'zijn alleen door jezelf ingevoerd en niet onafhankelijk geverifieerd.</small></footer></body></html>'
  if (new TextEncoder().encode(html).byteLength > 512000) {
    throw Error('Te veel privéregels voor één veilig afdrukbestand.')
  }
  return html
}
