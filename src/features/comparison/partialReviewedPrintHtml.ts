/** Static offline human receipt for already-admitted, locally reviewed source rows.
 * The caller supplies the same strict, at-click snapshot as its CSV export.
 * Empty financial fields must remain unknown, never represented as zero.
 */
export function partialReviewedPricePrintHtml(rows: readonly (readonly string[])[]): string {
  const esc = (s: string) => s.replace(/&/gu, '&amp;').replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&#39;')
  const shop = (row: readonly string[], offset: number, title: string): string => {
    const cells = row.slice(offset, offset + 11)
    const admitted = cells[0] === 'Bevestigde eigen bron'
    return '<div class="shop"><h3>' + title + '</h3><p>' + esc(cells[0]) + '</p>' +
      (admitted ? '<p>' + esc(cells[3]) + ' · broncode ' + esc(cells[2]) + '</p>' +
        '<p>' + esc(cells[4]) + ' hele pak(ken) · ' + esc(cells[7]) +
        ' × ' + esc(cells[5]) + ' ' + esc(cells[6]) + ' per pak</p>' +
        '<p>Pakprijs: ' + esc(cells[8]) + ' cent · regel: <strong>' +
        esc(cells[9]) + ' cent</strong> · ' + esc(cells[10]) + '</p>' :
        '<p>Prijs onbekend</p>') +
      (cells[1] ? '<small>Eigen bronmoment: ' + esc(cells[1]) + '</small>' : '') + '</div>'
  }
  const content = rows.slice(1).map(row => '<section class="ingredient"><h2>' +
    esc(row[1]) + ' · ' + esc(row[2]) + ' ' + esc(row[3]) + ' nodig</h2>' +
    '<div class="shops">' + shop(row, 4, 'PLUS') + shop(row, 15, 'DekaMarkt') +
    '</div><p>' + (row[26] ? 'Verschil DekaMarkt min PLUS: ' +
      esc(row[26]) + ' cent voor deze ingrediëntregel.' :
      'Verschil onbekend — geen compleet bevestigd prijzenpaar.') + '</p></section>').join('')
  return '<!doctype html><html lang="nl"><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">` +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>SUPA · Mijn eigen winkelprijzen per ingrediënt</title>' +
    '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:900px;margin:auto;padding:1rem;color:#253028}' +
    '.ingredient{margin:1.1rem 0;padding:1rem;border:1px solid #cad6ce;border-radius:12px;break-inside:avoid}' +
    '.shops{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}' +
    '.shop{min-width:0;overflow-wrap:anywhere}.shop h3{margin:.2rem 0}' +
    '.ingredient h2{font-size:1.08rem;margin:0 0 .6rem}small{color:#53635a}' +
    '@media(max-width:640px){.shops{grid-template-columns:1fr}}' +
    '@media print{body{padding:0}.ingredient{border:1px solid #ccc}}</style></head><body>' +
    '<h1>Mijn eigen bronprijzen — zelf controleren</h1><p>Alleen lokaal geaccepteerde recente bronregels ' +
    'krijgen geldbedragen. Leeg of onbekend is nooit gratis. Geen actuele kassagarantie, ' +
    'bronrecht, volledig mandtotaal of publieke besparingsclaim.</p>' + content +
    '</body></html>'
}
