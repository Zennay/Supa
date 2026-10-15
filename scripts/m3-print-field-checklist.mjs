import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildObservationSheet, M3_EXPECTED_RETAILERS } from '../src/domain/m3ObservationSheet.ts'

function htmlText(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char])
}
function validatedRequirements(sheet) {
  const items = sheet.requirements
  if (!Array.isArray(items) || items.length !== 11) throw new Error('Expected 11 M3 requirements')
  const seen = new Set()
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() ||
      seen.has(item.id) || typeof item.label !== 'string' ||
      !item.label.trim() || !['g','kg','ml','l','piece'].includes(item.unit) ||
      !Number.isFinite(item.amount) || item.amount <= 0) {
      throw new Error('Invalid M3 paper requirement')
    }
    seen.add(item.id)
  }
  for (const side of ['baseline', 'candidate']) {
    const lines = sheet[side]?.lines
    if (!Array.isArray(lines) || lines.length !== items.length) {
      throw new Error('Inconsistent M3 store rows')
    }
    for (let i = 0; i < items.length; i += 1) {
      if (lines[i]?.ingredientId !== items[i].id ||
        lines[i]?.ingredientLabel !== items[i].label ||
        lines[i]?.requirement?.amount !== items[i].amount ||
        lines[i]?.requirement?.unit !== items[i].unit) {
        throw new Error('Store rows disagree with canonical M3 demand')
      }
    }
  }
  return items
}
function paperPage(side, items) {
  const store = htmlText(M3_EXPECTED_RETAILERS[side])
  const cells = items.map((item, i) => {
    const unit = item.unit === 'piece' ? (item.amount === 1 ? 'stuk' : 'stuks') : item.unit
    return '<tr data-m3-row="' + (i + 1) + '"><td><strong>' +
      (i + 1) + '. ' + htmlText(item.label) +
      '</strong><small>Benodigd: ' + htmlText(item.amount + ' ' + unit) +
      '</small></td><td></td><td></td><td></td><td></td><td>☐ ja ☐ nee ☐ onbekend</td></tr>'
  }).join('\n')
  return '<section class="page" data-m3-side="' + side + '">' +
    '<p>SUPA M3 · veldmeting · blad ' + (side === 'baseline' ? '1/2' : '2/2') + '</p>' +
    '<h1>' + store + ' — dezelfde 11 boodschappen</h1>' +
    '<p>Noteer uitsluitend echt geobserveerde waarden; laat onbekende gegevens leeg.</p>' +
    '<div class="metadata"><p>Filiaal: __________________________</p>' +
    '<p>Datum, tijd en tijdzone: __________________________</p>' +
    '<p>Week vanaf (maandag): __________________________</p>' +
    '<p>Pseudonieme bewijsreferentie (geen naam/e-mail): __________________________</p>' +
    '<p>Prijscontext: ☐ in-store ☐ online-order (dezelfde bij beide winkels)</p>' +
    '<p>Bron: ☐ winkelmand ☐ bon ☐ toegestane export</p></div>' +
    '<table><thead><tr><th>Ingrediënt/behoefte</th><th>Gevonden product</th>' +
    '<th>Verpakking (hoeveelheid + eenheid)</th><th>Aantal pakken</th>' +
    '<th>Prijs per pak (€)</th><th>Beschikbaar?</th></tr></thead><tbody>' +
    cells + '</tbody></table>' +
    '<p>Herkomst / productlink / aanbieding / twijfel: __________________________________________________</p>' +
    '<p>___________________________________________________________________________________________</p>' +
    '<footer>Leeg invulblad; geen bewijs of besparingsclaim. Neem echte bevindingen over in SUPA Meten.</footer>' +
    '</section>'
}
export function renderM3PaperChecklist() {
  const requirements = validatedRequirements(buildObservationSheet())
  const css = '@page{size:A4 landscape;margin:12mm}' +
    'body{font:12px/1.4 Arial,sans-serif;color:#111;margin:0}' +
    '.page{break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}' +
    '.metadata{display:grid;grid-template-columns:1fr 1fr;gap:1px 20px;margin:9px 0}' +
    '.metadata p{margin:2px 0}h1{font-size:22px;margin:4px 0}' +
    'table{width:100%;border-collapse:collapse;table-layout:fixed}' +
    'th,td{border:1px solid #555;padding:5px;text-align:left;vertical-align:top}' +
    'th{background:#eee}th:first-child{width:25%}th:nth-child(2){width:22%}' +
    'th:nth-child(3){width:19%}th:nth-child(4){width:12%}th:nth-child(5){width:12%}th:last-child{width:10%}' +
    'td{height:39px}td small{display:block}td:last-child{white-space:nowrap;font-size:10px}' +
    'footer{border-top:1px solid #777;padding:5px 0;font-size:10px}' +
    '@media screen{body{background:#eee}.page{background:#fff;max-width:1200px;padding:24px;margin:16px auto}}'
  return '<!doctype html><html lang="nl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>SUPA M3 printformulier</title><style>' + css + '</style></head><body>' +
    paperPage('baseline', requirements) + paperPage('candidate', requirements) +
    '</body></html>\n'
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 0 && (argv.length !== 2 || argv[0] !== '--output' ||
    !argv[1] || argv[1].trim() !== argv[1] || argv[1].startsWith('-'))) {
    throw new Error('Invalid paper checklist arguments')
  }
  const content = renderM3PaperChecklist()
  if (argv.length === 0) return process.stdout.write(content)
  await mkdir(dirname(argv[1]), { recursive: true, mode: 0o700 })
  await writeFile(argv[1], content, { flag: 'wx', mode: 0o600, encoding: 'utf8' })
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('Could not create blank M3 field worksheet; no observed prices were generated')
    process.exitCode = 1
  })
}
