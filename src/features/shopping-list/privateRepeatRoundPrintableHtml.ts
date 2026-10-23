import type { PrivateShoppingTemplateItem } from './manualShoppingTemplate.ts'

const stores = ['PLUS', 'DekaMarkt', 'Algemeen'] as const
const escapeHtml = (value: string) => value.replace(/&/gu, '&amp;')
  .replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
  .replace(/"/gu, '&quot;').replace(/'/gu, '&#39;')

/** Offline printout of the user's own repeat-round words; NEVER a price capture. */
export function privateRepeatRoundPrintableHtml(
  name: string, items: readonly PrivateShoppingTemplateItem[],
): string {
  if (typeof name !== 'string' || !name.trim() || name.length > 60 ||
      !Array.isArray(items) || !items.length || items.length > 100 ||
      items.some(item => !item || !stores.includes(item.store as typeof stores[number]) ||
        typeof item.label !== 'string' || !item.label.trim() || item.label.length > 140)) {
    throw Error('Ongeldige privéherhaalronde voor afdrukken.')
  }
  const groups = stores.flatMap(shop => {
    const own = items.filter(item => item.store === shop)
    if (!own.length) return []
    return ['<section><h2>' + shop + ' · ' + own.length + ' artikelen</h2><ul>' +
      own.map(item => '<li><span aria-hidden="true">☐</span> ' +
        escapeHtml(item.label) + '</li>').join('') + '</ul></section>']
  }).join('')
  return '<!doctype html><html lang="nl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">` +
    '<title>SUPA · Privé herhaalronde</title>' +
    '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:760px;margin:auto;padding:24px;color:#202820}' +
    'section{break-inside:avoid;border-top:2px solid #ccc;margin:16px 0;padding:12px 0}' +
    'ul{padding:0;list-style:none}li{padding:7px 0;border-bottom:1px solid #ddd;overflow-wrap:anywhere}' +
    'li span{font-size:1.3em;margin-right:.6em}small{color:#555}' +
    '@media print{body{padding:0}section{break-inside:avoid}}</style></head><body>' +
    '<h1>' + escapeHtml(name) + '</h1><p>' + items.length +
    ' eigen artikelen om opnieuw te kopen · geen vinkjes overgenomen.</p>' +
    groups + '<footer><small>Persoonlijke ongeprijsde herhaalronde. ' +
    'Geen retailerbron, beschikbaarheidsclaim, SKU of besparing.</small></footer></body></html>'
}
