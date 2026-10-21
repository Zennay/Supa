/** Print-ready, entirely offline rendition of a human-review checklist.
 * A proposed SKU is not an accepted offer or evidence of retailer permission.
 * No remote content, scripts, images, links or fetches are embedded.
 */
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? '')

export function privateTwoStorePreviewPrintHtml(checklist: string): string {
  if (!checklist.startsWith('SUPA · PRIVÉ · TWEE WINKELBRONNEN TER CONTROLE') ||
      new TextEncoder().encode(checklist).length > 256000) {
    throw Error('Geen geldig privébroncontroleblad voor afdruk beschikbaar.')
  }
  return [
    '<!doctype html><html lang="nl"><head><meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Supa · PLUS en DekaMarkt broncontrole · privé</title>',
    '<style>',
    'body{color:#183f30;font:16px/1.5 system-ui,sans-serif;max-width:920px;margin:2rem auto;padding:0 1.2rem}',
    'h1{font-size:1.5rem}p{padding:.8rem;border:2px solid #8b4b23;border-radius:.5rem}',
    'pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.85}',
    '@media print{body{margin:0;max-width:none;font-size:11pt}pre{line-height:1.65}p{break-inside:avoid}}',
    '</style></head><body><h1>Supa · controleer beide winkelbronnen</h1>',
    '<p>Privé concept voor eigen veldcontrole. Geen goedgekeurde winkelprijzen,',
    ' compleet mandbedrag, winkeltoestemming of besparingsbewijs.',
    ' Print dit lokale bestand alleen als je de originele bronproducten handmatig wilt nalopen.</p>',
    '<pre>', escapeHtml(checklist), '</pre></body></html>',
  ].join('')
}
