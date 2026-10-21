import { euro as exactEuro } from '../../lib/money.ts'
import { useState } from 'react'
import type { BasketTraceLine, OneStoreBasket } from '../../domain/basket.ts'
import { compareFullBaskets, samePhysicalDemand } from '../../domain/basketComparison.ts'
import { privateUnitPrice } from './privateUnitPrice.ts'

const COLUMNS = [
  'plusObservedAt', 'dekaObservedAt', 'comparisonStatus',
  'ingredientId', 'ingredient', 'requiredAmount', 'requiredUnit',
  'plusStatus', 'plusProduct', 'plusProductId', 'plusPacks', 'plusPackAmount', 'plusPackUnit',
  'plusPackCount', 'plusPackPriceCents', 'plusUnitPrice', 'plusLineCents',
  'dekaStatus', 'dekaProduct', 'dekaProductId', 'dekaPacks', 'dekaPackAmount', 'dekaPackUnit',
  'dekaPackCount', 'dekaPackPriceCents', 'dekaUnitPrice', 'dekaLineCents',
  'deltaCentsDekaMinusPlus',
]

function cell(value: string | number): string {
  // A signed, already-validated arithmetic delta is a NUMBER, not a formula
  // supplied by a product name. Do not prefix negative cents with an apostrophe
  // (that would turn valid -125 numeric differences into spreadsheet text).
  // Invalid JS numbers are never allowed into this downloadable money ledger.
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Ongeldige numerieke prijsdata')
    return '"' + String(value) + '"'
  }
  const input = value
  // Protect spreadsheet importers from formula-like product/ingredient names.
  // NFKC detects width/compatibility aliases. Strip invisible format marks,
  // combining marks and Unicode whitespace only for the safety check, not
  // from the exported original label. This also covers bidi overrides and
  // word joiners before a spreadsheet formula prefix.
  const leading = input.normalize('NFKC')
    .replace(/^[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Mark}]*/gu, '')
  const text = /^[=+\-@\u2212]/u.test(leading) ? "'" + input : input
  return '"' + text.replace(/"/g, '""') + '"'
}

function lineFields(line: BasketTraceLine): (string | number)[] {
  // Ten fields per store, even when no source product or price is known.
  // A short row shifts the next store's columns into the wrong money fields.
  if (line.status !== 'matched') return [
    'niet gekoppeld', '', '', '', '', '', '', '', '', '',
  ]
  return [
    line.reasons.includes('explicit local user selection; not an automatic or verified retailer match')
      ? 'door gebruiker gekoppeld' : 'automatisch gekoppeld',
    line.productName, line.productId, line.packs, line.pack.amount,
    line.pack.unit, line.pack.count, line.pricePerPackCents,
    privateUnitPrice(line) ?? 'eenheidsprijs onbekend', line.lineTotalCents,
  ]
}

function physicalLedgerValid(basket: OneStoreBasket): boolean {
  try {
    if (!basket || !Array.isArray(basket.lines) ||
        !Number.isSafeInteger(basket.totalCents) || basket.totalCents < 0 ||
        !Number.isSafeInteger(basket.matchedLineCount) || basket.matchedLineCount < 0 ||
        !Number.isSafeInteger(basket.unresolvedLineCount) || basket.unresolvedLineCount < 0 ||
        basket.matchedLineCount + basket.unresolvedLineCount !== basket.lines.length ||
        basket.lines.length > 1000) return false
    let matched = 0
    let unresolved = 0
    let sum = 0
    const ids = new Set<string>()
    for (const item of basket.lines) {
      if (!item || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) return false
      ids.add(item.id)
      if (item.status === 'unresolved') { unresolved++; continue }
      if (item.status !== 'matched' || !Number.isSafeInteger(item.packs) || item.packs <= 0 ||
          !Number.isSafeInteger(item.pricePerPackCents) || item.pricePerPackCents < 0 ||
          !Number.isSafeInteger(item.lineTotalCents) || item.lineTotalCents < 0 ||
          item.lineTotalCents !== item.packs * item.pricePerPackCents) return false
      matched++
      sum += item.lineTotalCents
      if (!Number.isSafeInteger(sum)) return false
    }
    return matched === basket.matchedLineCount &&
      unresolved === basket.unresolvedLineCount && sum === basket.totalCents
  } catch { return false }
}

function buildCsv(plus: OneStoreBasket, deka: OneStoreBasket,
  plusObservedAt: string, dekaObservedAt: string, comparable: boolean): string {
  if (!physicalLedgerValid(plus) || !physicalLedgerValid(deka)) {
    throw new Error('Mandgegevens zijn niet volledig consistent.')
  }
  if (!plus.lines.length || plus.lines.length !== deka.lines.length ||
      plus.selectedMealCount <= 0 || deka.selectedMealCount <= 0 ||
      plus.selectedMealCount !== deka.selectedMealCount) {
    throw new Error('Kies dezelfde geplande ingrediënten voor beide winkels.')
  }
  const dekaById = new Map(deka.lines.map(line => [line.id, line]))
  if (dekaById.size !== deka.lines.length ||
      plus.lines.some(item => !dekaById.has(item.id))) {
    throw new Error('De twee mandjes bevatten verschillende ingrediëntbehoeften.')
  }
  const complete = plus.unresolvedLineCount === 0 && deka.unresolvedLineCount === 0
  // Never trust an optimistic UI flag alone for private monetary deltas.
  // The existing canonical comparator checks physical demand, whole-pack
  // arithmetic, exact store identity and complete matched coverage.
  const showMoneyDifference = comparable && complete &&
    compareFullBaskets({ baseline: plus, candidate: deka }).claimable
  const state = showMoneyDifference ? 'privé rekenkundig vergelijkbaar' :
    'geen volledig of actueel vergelijkbaar prijsverschil'
  const rows = plus.lines.map(plusLine => {
    const dekaLine = dekaById.get(plusLine.id)!
    const sameDemand = samePhysicalDemand(plusLine.requirement, dekaLine.requirement) ||
      (plusLine.requirement.amount === null && dekaLine.requirement.amount === null &&
        plusLine.requirement.unit === dekaLine.requirement.unit)
    if (!sameDemand) throw new Error('De fysieke ingrediëntbehoefte verschilt tussen winkels.')
    return [
      plusObservedAt, dekaObservedAt, state,
      plusLine.id, plusLine.ingredientLabel, plusLine.requirement.amount ?? '',
      plusLine.requirement.unit,
      ...lineFields(plusLine), ...lineFields(dekaLine),
      showMoneyDifference && plusLine.status === 'matched' && dekaLine.status === 'matched'
        ? dekaLine.lineTotalCents - plusLine.lineTotalCents : '',
    ]
  })
  const header = COLUMNS.map(cell).join(',')
  const csvLines = rows.map(values => {
    if (values.length !== COLUMNS.length) {
      throw new Error('De privévergelijking bevat onvolledige CSV-kolommen.')
    }
    return values.map(cell).join(',')
  })
  return '\uFEFF' + [header, ...csvLines].join('\r\n') + '\r\n'
}

/**
 * Portable, printable private price overview. Reuse the exact same physical
 * ledger/same-demand admission as CSV; do not create a second looser trust
 * path for downloaded HTML. This is a local document, not a price publication.
 */
export function privateComparisonHtml(
  plus: OneStoreBasket,
  deka: OneStoreBasket,
  plusObservedAt: string,
  dekaObservedAt: string,
  comparable: boolean,
  generatedAt: string,
): string {
  // This throws if a basket total, physical row or shared ingredient changes
  // independently of the paired comparison. Never print a forged winner.
  buildCsv(plus, deka, plusObservedAt, dekaObservedAt, comparable)
  const complete = plus.unresolvedLineCount === 0 && deka.unresolvedLineCount === 0
  const showDifference = comparable && complete &&
    compareFullBaskets({ baseline: plus, candidate: deka }).claimable
  const clean = (value: string | number | null) => String(value ?? '')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const money = (cents: number) => exactEuro.formatCents(cents)
  const dekaLines = new Map(deka.lines.map(line => [line.id, line] as const))
  function product(line: BasketTraceLine) {
    if (line.status === 'unresolved') return '<strong>Niet gekoppeld</strong><br><small>Prijs onbekend — handmatig kiezen</small>'
    return '<strong>' + clean(line.productName) + '</strong><br>' +
      '<small>Originele broncode: ' + clean(line.productId) + '</small><br>' +
      clean(line.packs) + ' × ' + clean(money(line.pricePerPackCents)) +
      ' · ' + clean(line.pack.count) + ' × ' + clean(line.pack.amount) + ' ' +
      clean(line.pack.unit) + ' per verpakking<br><small>' +
      clean(privateUnitPrice(line) ?? 'Eenheidsprijs onbekend') + '</small><br><b>' +
      clean(money(line.lineTotalCents)) + '</b>'
  }
  const rows = plus.lines.map(line => {
    const other = dekaLines.get(line.id)
    if (!other) throw new Error('Een winkelregel ontbreekt.')
    const bothKnown = showDifference && line.status === 'matched' && other.status === 'matched'
    const delta = bothKnown ? other.lineTotalCents - line.lineTotalCents : null
    const outcome = delta === null ? 'Niet vergelijkbaar' : delta === 0 ? 'Gelijk' :
      money(Math.abs(delta)) + (delta > 0 ? ' · PLUS lager' : ' · DekaMarkt lager')
    const required = line.requirement.amount === null ? 'hoeveelheid onbekend' :
      String(line.requirement.amount).replace('.', ',') + ' ' + line.requirement.unit
    return '<tr><th scope="row">' + clean(line.ingredientLabel) +
      '<small>Benodigd: ' + clean(required) + '</small></th><td>' + product(line) +
      '</td><td>' + product(other) + '</td><td>' + clean(outcome) + '</td></tr>'
  }).join('\n')
  const totals = showDifference ? '<section class="totals"><div><span>PLUS</span><strong>' +
    clean(money(plus.totalCents)) + '</strong></div><div><span>DekaMarkt</span><strong>' +
    clean(money(deka.totalCents)) + '</strong></div><div><span>Verschil (DekaMarkt − PLUS)</span><strong>' +
    clean(money(Math.abs(deka.totalCents - plus.totalCents))) +
    '</strong><small>' + (deka.totalCents === plus.totalCents ? 'Gelijk' :
      deka.totalCents > plus.totalCents ? 'PLUS is lager' : 'DekaMarkt is lager') +
    '</small></div></section>' :
    '<p class="notice">Geen volledig en actueel vergelijkbare mandprijzen. Bekende afzonderlijke ' +
    'productbedragen zijn alleen ter controle zichtbaar; ontbrekende prijzen zijn nooit € 0,00.</p>'
  return '<!doctype html><html lang="nl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="referrer" content="no-referrer">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; ' +
    'style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">' +
    '<title>SUPA — privé winkelvergelijking</title>' +
    '<style>body{font:16px/1.45 system-ui,sans-serif;color:#172c22;max-width:1100px;' +
    'margin:2rem auto;padding:0 1rem}h1{margin-bottom:.25rem}h2{font-size:1.1rem}' +
    '.notice{border-left:4px solid #386344;padding:1rem;background:#f4f8f4}' +
    '.meta{display:flex;gap:1rem;flex-wrap:wrap}.meta p{flex:1 1 230px}' +
    '.totals{display:flex;gap:.8rem;flex-wrap:wrap}.totals div{flex:1 1 160px;' +
    'border:1px solid #cad8cb;padding:1rem;border-radius:9px}' +
    '.totals span,.totals small,th small{display:block}.totals strong{font-size:1.3rem}' +
    'table{width:100%;border-collapse:collapse;margin-top:1rem}' +
    'th,td{text-align:left;vertical-align:top;border-bottom:1px solid #d5ddd6;' +
    'padding:.65rem .4rem;overflow-wrap:anywhere}th{background:#f5f8f5}' +
    'td small{color:#515e55}footer{margin:1.4rem 0;color:#4e5e52}' +
    '@media(max-width:650px){table{display:block;overflow-x:auto}th,td{min-width:135px}}' +
    '@media print{body{max-width:none;margin:0;font-size:11pt}thead{display:table-header-group}' +
    'tr{break-inside:avoid}.notice{border:1px solid #666}}' +
    '</style></head><body><header><h1>SUPA · eigen winkelvergelijking</h1>' +
    '<p class="notice"><strong>PRIVÉ — NIET ONAFHANKELIJK GEVERIFIEERD.</strong> ' +
    'Deze lokale opnames bewijzen geen actuele winkelprijs, bronrechten of echte besparing. ' +
    'Dit bestand bevat geen scripts of externe bronnen.</p></header>' +
    '<div class="meta"><p><strong>PLUS waargenomen:</strong><br>' + clean(plusObservedAt) +
    '</p><p><strong>DekaMarkt waargenomen:</strong><br>' + clean(dekaObservedAt) +
    '</p><p><strong>Bestand aangemaakt (apparaatklok):</strong><br>' +
    clean(generatedAt) + '</p></div><h2>' + (showDifference ? 'Volledig privémandje — rekenkundige vergelijking' :
      'Onvolledig of verouderd — geen betrouwbaar totaalverschil') +
    '</h2>' + totals + '<table><thead><tr><th>Gepland ingrediënt</th><th>PLUS</th>' +
    '<th>DekaMarkt</th><th>Verschil</th></tr></thead><tbody>' + rows +
    '</tbody></table><footer>Bron: uitsluitend eigen lokaal geïmporteerde prijsopnames. ' +
    'Hele verpakkingen; onbekende, verlopen of ontbrekende regels tellen niet als gratis. ' +
    'Controleer alle producten zelf vóór aankoop.</footer></body></html>'
}

/** User-initiated local CSV export: no publication, no retailer network or inferred prices. */
export function PrivateBasketComparisonExport({
  plus, deka, plusObservedAt, dekaObservedAt, comparable, eligibleNow, showCsv = true,
}: {
  plus: OneStoreBasket
  deka: OneStoreBasket
  plusObservedAt: string
  dekaObservedAt: string
  comparable: boolean
  /** At the moment of download, re-evaluate the existing exact nanosecond
   * freshness and canonical same-basket gates, not last-minute UI state. */
  eligibleNow: () => boolean
  /** The normal Supa app already has a strict CSV export; avoid duplicate actions. */
  showCsv?: boolean
}) {
  const [message, setMessage] = useState('')
  const download = () => {
    try {
      const csv = buildCsv(plus, deka, plusObservedAt, dekaObservedAt,
        comparable && eligibleNow())
      const uri = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      try {
        const a = document.createElement('a')
        a.href = uri
        a.download = 'supa-twee-winkels-private-vergelijking.csv'
        document.body.append(a)
        a.click()
        a.remove()
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(uri), 1000)
      }
      setMessage('Privéprijsvergelijking als CSV gedownload. Controleer de bronwaarden zelf.')
    } catch {
      setMessage('Kon geen betrouwbaar overzicht maken. Controleer beide mandjes.')
    }
  }
  const downloadHtml = () => {
    try {
      const html = privateComparisonHtml(plus, deka, plusObservedAt, dekaObservedAt,
        comparable && eligibleNow(), new Date().toISOString())
      const uri = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = uri
        link.download = 'supa-mijn-prive-twee-winkels-overzicht.html'
        document.body.append(link)
        link.click()
        link.remove()
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(uri), 1000)
      }
      setMessage('Afdrukbaar privéoverzicht gedownload. Open het lokaal om af te drukken.')
    } catch {
      setMessage('Geen betrouwbaar afdrukbaar overzicht beschikbaar. Controleer beide mandjes.')
    }
  }
  return <div className="offline-price-workbench__export">
    {showCsv && <button type="button" className="ghost-button" onClick={download}
      disabled={plus.lines.length === 0 || deka.lines.length === 0}>
      Download volledig prijs- en matchingoverzicht (CSV)
    </button>}
    <button type="button" className="ghost-button" onClick={downloadHtml}
      disabled={plus.lines.length === 0 || deka.lines.length === 0}>
      Download afdrukbaar privéoverzicht (HTML)
    </button>
    <p className="disclaimer">Het afdrukbare overzicht werkt volledig offline, toont de twee
      winkelopnames naast elkaar en laat een winnaar of totaalverschil weg zolang prijzen
      ontbreken, verouderd zijn of de mandjes niet gelijkwaardig zijn.</p>
    <p className="disclaimer">Per ingrediënt: benodigde hoeveelheid, gekoppeld of onbekend,
      verpakking en hele eurocenten voor beide winkels. Bij ontbrekende of verlopen prijzen
      staan er geen prijsverschillen in het bestand. Alle gegevens zijn afkomstig uit jouw eigen
      lokale invoer; dit is geen officieel prijsbewijs of besparingsonderzoek.</p>
    {message && <p role="status" aria-live="polite">{message}</p>}
  </div>
}
