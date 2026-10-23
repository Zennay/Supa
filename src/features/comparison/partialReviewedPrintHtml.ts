/** Static offline human receipt for already-admitted, locally reviewed source rows.
 * Financial positions are discovered from the exported header, not fixed
 * indices: optional source provenance must NEVER be mistaken for price data.
 * No external link, script or network content is embedded.
 */
export function partialReviewedPricePrintHtml(rows: readonly (readonly string[])[]): string {
  const esc = (s: string) => s.replace(/&/gu, '&amp;').replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&#39;')
  const header = rows[0] ?? []
  const hasSourceColumns = header.includes('PLUS_bron_url') &&
    header.includes('DekaMarkt_bron_url') &&
    header.includes('PLUS_snapshot_sha256') &&
    header.includes('DekaMarkt_snapshot_sha256')
  const shopWidth = hasSourceColumns ? 14 : 11
  const plusOffset = 4
  const dekaOffset = plusOffset + shopWidth
  const deltaIndex = header.indexOf('Deka_minus_PLUS_cent')
  if (deltaIndex !== dekaOffset + shopWidth ||
      header[dekaOffset] !== 'DekaMarkt_status' ||
      header[plusOffset] !== 'PLUS_status') {
    throw new Error('Onbekend kolomschema voor het privé-prijsrapport.')
  }
  const isCentAmount = (value: string | undefined): value is string =>
    typeof value === 'string' && /^-?(?:0|[1-9]\d*)$/u.test(value) &&
    Number.isSafeInteger(Number(value))

  const shop = (row: readonly string[], offset: number, title: string): string => {
    const cells = row.slice(offset, offset + shopWidth)
    const admitted = cells[0] === 'Bevestigde eigen bron'
    const sourceDetails = hasSourceColumns &&
      (cells[11] || cells[12] || cells[13])
      ? '<details><summary>Herkomst van de eigen prijsbron</summary>' +
        (cells[11] ? '<p>Bron-URL: <code>' + esc(cells[11]) + '</code></p>' : '') +
        (cells[12] ? '<p>Bronsoort: ' + esc(cells[12]) + '</p>' : '') +
        (cells[13] ? '<p>Snapshot SHA-256: <code>' + esc(cells[13]) + '</code></p>' : '') +
        '<small>Herkomst is geen bronrecht, actuele prijsgarantie of onafhankelijk winkelbewijs.</small></details>'
      : ''
    return '<div class="shop"><h3>' + title + '</h3><p>' +
      esc(cells[0] ?? 'Geen bron') + '</p>' +
      (admitted ? '<p>' + esc(cells[3] ?? '') + ' · broncode ' +
        esc(cells[2] ?? '') + '</p>' +
        '<p>' + esc(cells[4] ?? '') + ' hele pak(ken) · ' +
        esc(cells[7] ?? '') + ' × ' + esc(cells[5] ?? '') + ' ' +
        esc(cells[6] ?? '') + ' per pak</p>' +
        '<p>Pakprijs: ' + esc(cells[8] ?? '') + ' cent · regel: <strong>' +
        esc(cells[9] ?? '') + ' cent</strong> · ' +
        esc(cells[10] ?? '') + '</p>' :
        '<p>Prijs onbekend</p>') +
      (cells[1] ? '<small>Eigen bronmoment: ' + esc(cells[1]) + '</small>' : '') +
      sourceDetails + '</div>'
  }

  const content = rows.slice(1).map(row => {
    const delta = row[deltaIndex]
    // Only a structurally identified, safe integer price gap may be printed.
    // Unknown gaps are never silently converted into 0 cents or a winner.
    const deltaText = isCentAmount(delta)
      ? 'Verschil DekaMarkt min PLUS: ' + esc(delta) +
        ' cent voor deze ingrediëntregel.'
      : 'Verschil onbekend — geen compleet bevestigd prijzenpaar.'
    // Legacy exports may include separate, explicitly named unit-gap columns;
    // never read positions 28/29 directly (now source URL/kind columns).
    const unitGapIndex = header.indexOf('eenheidsprijsverschil_cent')
    const unitGap = unitGapIndex >= 0 ? row[unitGapIndex] : undefined
    const unitName = unitGapIndex >= 0 ? row[unitGapIndex + 1] : undefined
    const unitDifference = isCentAmount(unitGap) && unitName
      ? '<p>Eenheidsprijsverschil DekaMarkt min PLUS: ' + esc(unitGap) +
        ' cent per ' + esc(unitName) +
        ' (afgerond; alleen dezelfde maateenheidfamilie).</p>'
      : ''
    return '<section class="ingredient"><h2>' +
      esc(row[1] ?? '') + ' · ' + esc(row[2] ?? '') + ' ' +
      esc(row[3] ?? '') + ' nodig</h2>' +
      '<div class="shops">' + shop(row, plusOffset, 'PLUS') +
      shop(row, dekaOffset, 'DekaMarkt') +
      '</div><p>' + deltaText + '</p>' + unitDifference + '</section>'
  }).join('')
  return '<!doctype html><html lang="nl"><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">` +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>SUPA · Mijn eigen winkelprijzen per ingrediënt</title>' +
    '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:900px;margin:auto;padding:1rem;color:#253028}' +
    '.ingredient{margin:1.1rem 0;padding:1rem;border:1px solid #cad6ce;border-radius:12px;break-inside:avoid}' +
    '.shops{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}' +
    '.shop{min-width:0;overflow-wrap:anywhere}.shop h3{margin:.2rem 0}' +
    '.ingredient h2{font-size:1.08rem;margin:0 0 .6rem}small{color:#53635a}' +
    'details{margin-top:.4rem}code{overflow-wrap:anywhere}' +
    '@media(max-width:640px){.shops{grid-template-columns:1fr}}' +
    '@media print{body{padding:0}.ingredient{border:1px solid #ccc}}</style></head><body>' +
    '<h1>Mijn eigen bronprijzen — zelf controleren</h1><p>Alleen lokaal geaccepteerde recente bronregels ' +
    'krijgen geldbedragen. Leeg of onbekend is nooit gratis. Geen actuele kassagarantie, ' +
    'bronrecht, volledig mandtotaal of publieke besparingsclaim.</p>' + content +
    '</body></html>'
}
