import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compareLocalRetailerSnapshots } from './retailer-compare-local-snapshots.mjs'
import { renderPrivateShoppingChecklists } from './retailer-private-shopping-checklist.mjs'
import {
  assertNoSymlinkedM3OutputParents,
  writeDerivedM3Output,
  privateM3OutputFailure,
} from './m3-source-output-preservation.mjs'

// Use the same validated, physical-purchase checklist as the text CLI.
// The HTML layer must never rederive prices or decide which retailer wins.
const escapeHtml = value => value.replace(/&/g, '&amp;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export function renderPrintablePrivateShoppingChecklist(report) {
  const plain = renderPrivateShoppingChecklists(report)
  const shops = []
  let active = null
  for (const line of plain.split('\n')) {
    if (line === '== PLUS ==' || line === '== DekaMarkt ==') {
      active = { name: line === '== PLUS ==' ? 'PLUS' : 'DekaMarkt',
        items: [], total: null }
      shops.push(active)
      continue
    }
    if (!active || !line) continue
    const purchase = line.startsWith('[ ] ')
    const shared = line.startsWith('[=] ')
    const unknown = line.startsWith('[?] ')
    if (purchase || shared || unknown) {
      const label = escapeHtml(line.slice(4))
      active.items.push('<li class="' + (purchase ? 'buy' : shared ? 'shared' : 'unknown') +
        '">' + (purchase
          ? '<label><input type="checkbox" aria-label="Afvinken: ' +
            label + '"><span>' + label + '</span></label>'
          : '<span class="status">' + (shared ? 'Al gedekt' : 'Controleren') +
            '</span><span>' + label + '</span>') + '</li>')
    } else if (line.startsWith('ALLEEN OFFLINE TOTAAL ' + active.name + ': ') ||
               line.startsWith('GEEN BETROUWBAAR VOLLEDIG TOTAAL ' + active.name + ': ')) {
      active.total = line
    }
  }
  if (shops.length !== 2 || shops[0].name !== 'PLUS' ||
      shops[1].name !== 'DekaMarkt' || shops.some(s => !s.total)) {
    throw new Error('Invalid private checklist presentation')
  }
  const cards = shops.map(s => '<section aria-label="' + s.name +
    '" class="shop shop-' + (s.name === 'PLUS' ? 'plus' : 'dekamarkt') + '"><h2>' + s.name + '</h2><ol>' + s.items.join('') +
    '</ol><p class="total">' + escapeHtml(s.total) + '</p></section>').join('\n')
  return '<!doctype html>\n<html lang="nl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; ' +
      'script-src &#39;none&#39;; img-src &#39;none&#39;; ' +
      'style-src &#39;unsafe-inline&#39;; form-action &#39;none&#39;; base-uri &#39;none&#39;">' +
    '<title>SUPA · Privé boodschappenchecklists</title><style>' +
    ':root{font-family:system-ui,sans-serif;color:#18372f;background:#f4f8f5}' +
    'body{max-width:1020px;padding:20px;margin:auto}h1{margin-bottom:8px}' +
    '.warning{background:#fff5d9;border-left:5px solid #b67b11;padding:16px;line-height:1.55}' +
    '.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:20px}' +
    '.shop{background:white;border:1px solid #d7e5df;padding:18px;border-radius:12px}' +
    '.store-filter{border:1px solid #d7e5df;border-radius:8px;background:white;padding:12px;margin-top:18px}' +
    '.store-filter legend{font-weight:700}.store-filter label{display:inline-flex;align-items:center;gap:8px;margin:4px 15px 4px 0}' +
    '.store-filter input{width:18px;height:18px}' +
    'body:has(#view-plus:checked) .shop-dekamarkt,body:has(#view-deka:checked) .shop-plus{display:none}' +
    'ol{padding-left:22px}li{padding:12px 0;border-bottom:1px solid #e1e7e3;overflow-wrap:anywhere}' +
    'label{display:flex;align-items:flex-start;gap:12px;cursor:pointer}' +
    'input{width:20px;height:20px;flex:none;accent-color:#18624c}' +
    'input:checked+span{text-decoration:line-through;color:#53635b}' +
    '.status{display:block;font-size:.83rem;font-weight:bold;color:#755117}' +
    '.unknown{background:#fff9ed}.shared{color:#446154}' +
    '.total{font-weight:700;border-top:2px solid #18624c;padding-top:14px}' +
    'footer{margin-top:24px;color:#53635b;line-height:1.55}' +
    '@media(max-width:710px){.grid{grid-template-columns:1fr}body{padding:12px}}' +
    '@media print{:root{background:white}body{max-width:none;padding:0}' +
    '.store-filter{display:none}' +
    '.grid{grid-template-columns:1fr}.shop{break-inside:avoid;box-shadow:none}' +
    'input:checked+span{text-decoration:none}}' +
    '</style></head><body><header><h1>SUPA · Boodschappen afvinken</h1>' +
    '<p>Twee afzonderlijke winkels; hele fysieke verpakkingen, gedeelde aankopen slechts eenmaal.</p>' +
    '</header><div class="warning"><strong>PRIVÉ · ALLEEN OFFLINE.</strong> ' +
    'Geen live prijzen, geen winkeladvies, geen bewezen besparing. ' +
    'Controleer verpakking, actuele prijs en voorraad zelf in de winkel. ' +
    'Afvinken wordt niet opgeslagen en verstuurt niets.</div>' +
    '<fieldset class="store-filter"><legend>Welke boodschappenlijst wil je bekijken of printen?</legend>' +
    '<label><input type="radio" name="storeView" id="view-both" checked>Beide winkels</label>' +
    '<label><input type="radio" name="storeView" id="view-plus">Alleen PLUS</label>' +
    '<label><input type="radio" name="storeView" id="view-deka">Alleen DekaMarkt</label>' +
    '</fieldset><main class="grid">' + cards + '</main>' +
    '<footer>Lokale vergelijking van snapshots. Een onbekende winkelregel ' +
    'mag nooit als volledig mandbedrag worden behandeld. ' +
    'Geen gegevens worden verzonden of automatisch bijgewerkt.</footer>' +
    '</body></html>\n'
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    const help = 'SUPA · privé printbare winkelchecklists (offline M3)\n' +
      'Gebruik: node --experimental-strip-types ' +
      'scripts/retailer-private-shopping-checklist-html.mjs ' +
      '<lokaal-manifest.json> --output <prive-checklist.html>\n' +
      'Geen winkelverkeer; geen live prijs of publieke besparingsclaim.\n'
    process.stdout.write(help)
    return help
  }
  if (argv.length !== 3 || argv[1] !== '--output' ||
      !argv[0] || argv[0].startsWith('-') ||
      !argv[2] || argv[2].startsWith('-') || argv[2] !== argv[2].trim() ||
      !argv[2].toLowerCase().endsWith('.html')) {
    throw new Error('Invalid private offline checklist HTML arguments')
  }
  const report = await compareLocalRetailerSnapshots(argv[0])
  const html = renderPrintablePrivateShoppingChecklist(report)
  try {
    await assertNoSymlinkedM3OutputParents(argv[2])
    await mkdir(dirname(argv[2]), { recursive: true, mode: 0o700 })
    await writeDerivedM3Output(argv[0], argv[2], html)
  } catch (error) { throw privateM3OutputFailure(error) }
  return html
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write('Private offline shopping checklist could not be generated\n')
    process.exitCode = 1
  })
}
