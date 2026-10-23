/** Static, script-free local snapshot of a *visible* private comparison.
 * The caller must revoke stale results before taking its DOM text snapshot.
 * This creates no new price authority and performs no retailer/network I/O.
 */
export type PrivateBasketSnapshot = {
  capturedAt: string
  summary: string
  sourceMoments: string
  rows: readonly (readonly [string, string, string, string])[]
  nextActions: readonly string[]
}
const escape = (value: string): string => value.replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
export function renderPrivateBasketSnapshot(data: PrivateBasketSnapshot): string {
  if (data.rows.length < 1 || data.rows.length > 1000 ||
      !data.capturedAt || !data.summary || !data.sourceMoments) {
    throw Error('Geen volledig zichtbare privérapportage')
  }
  const rows = data.rows.map(values =>
    '<tr><th scope="row">' + escape(values[0]) + '</th>' +
    values.slice(1).map(value => '<td>' + escape(value) + '</td>').join('') +
    '</tr>').join('\n')
  const missing = data.nextActions.length
    ? '<section><h2>Ontbrekende winkelgegevens</h2><ul>' +
      data.nextActions.map(value => '<li>' + escape(value) + '</li>').join('') +
      '</ul></section>'
    : ''
  const html = '<!doctype html><html lang="nl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow">' +
    '<meta name="referrer" content="no-referrer">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;; object-src &#39;none&#39;">' +
    '<title>Supa · Privé winkelmandmomentopname</title>' +
    '<style>*{box-sizing:border-box}body{font:16px/1.55 system-ui,sans-serif;background:#f5f8f4;color:#173d2c;margin:0}' +
    'main{max-width:1100px;margin:auto;padding:28px 16px 70px}h1{font-size:clamp(1.5rem,4vw,2.4rem)}' +
    'section{background:white;border:1px solid #d4e2d8;border-radius:14px;padding:17px;margin:20px 0}' +
    'table{border-collapse:collapse;width:100%;min-width:650px}th,td{padding:11px;text-align:left;vertical-align:top;border-bottom:1px solid #dce9de;white-space:pre-wrap;overflow-wrap:anywhere}' +
    '.scroll{overflow-x:auto}.warning{border-left:5px solid #ac761b}small{color:#52685a}' +
    '@media print{body{background:white}section{border:0;padding:0}main{max-width:none}}</style>' +
    '</head><body><main><p>SUPA · EIGEN OPNAMES · PRIVÉ</p>' +
    '<h1>Hetzelfde mandje, twee winkels — momentopname</h1>' +
    '<p><strong>Bestand lokaal gemaakt:</strong> ' + escape(data.capturedAt) + '</p>' +
    '<section class="warning"><strong>Historisch privéoverzicht, geen actuele kassaprijs.</strong>' +
    '<p>Dit bestand wordt na downloaden niet bijgewerkt. De getoonde prijzen komen alleen uit eigen lokale waarnemingen. ' +
    'Gebruik deze momentopname niet voor een latere actuele prijs- of publieke besparingsclaim; open nieuwe brondata in Supa voor een nieuwe vergelijking.</p></section>' +
    '<section><h2>Uitkomst op het exportmoment</h2><p>' + escape(data.summary) +
    '</p><p><small>' + escape(data.sourceMoments) + '</small></p></section>' +
    '<section><h2>Hele verpakkingen en eenheidsprijzen</h2><div class="scroll"><table><thead><tr>' +
    '<th>Ingrediënt en fysieke behoefte</th><th>PLUS</th><th>DekaMarkt</th>' +
    '<th>Verschil</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>' +
    missing +
    '<p><small>Eenheidsprijzen zijn indicatief. Onbekende of onvolledige regels zijn geen €0-producten. ' +
    'Dit bestand bevat geen actieve scripts, haalt geen externe bestanden op en wordt niet automatisch verzonden.</small></p>' +
    '</main></body></html>\n'
  if (new TextEncoder().encode(html).length > 256000) throw Error('Privé HTML is te groot')
  return html
}
