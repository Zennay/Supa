import { makeBlankPlannerCaptureCsv, type CaptureStore } from './plannerPriceCaptureSheet.ts'
import { readablePlannerDemandAmount, type PlannerCaptureGuideNeed } from './plannerPriceCaptureGuide.ts'

// Only an inert local document is emitted; it never fetches external content.
const htmlText = (raw: string): string => raw
  .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
  .slice(0, 180)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

export function makePrintablePlannerCaptureHtml(
  needs: readonly PlannerCaptureGuideNeed[],
  selectedStores: readonly CaptureStore[],
  // Optional private recipe provenance, aligned with the same canonical needs
  // order as the CSV. Never derived from retailer product names or prices.
  originalRecipeNames?: readonly (readonly string[])[],
): string {
  makeBlankPlannerCaptureCsv(needs, selectedStores)
  if (originalRecipeNames && (
    originalRecipeNames.length !== needs.length ||
    originalRecipeNames.some(names => !Array.isArray(names) || names.some(name => typeof name !== 'string'))
  )) throw new Error('De recept-herkomst komt niet overeen met de fysieke CSV-rijen.')
  const sections = selectedStores.map((store, storeIndex) => {
    const rows = needs.map((need, index) => {
      const rowNumber = 2 + storeIndex * needs.length + index
      const amount = readablePlannerDemandAmount(need.amount)
      const physical = amount === 'hoeveelheid nog controleren'
        ? 'Hoeveelheid nog controleren' : amount + ' ' + need.unit
      const recipeNames = originalRecipeNames?.[index] ?? []
      const uniqueRecipes = [...new Set(recipeNames.map(name => name.trim()).filter(Boolean))]
      const origins = uniqueRecipes.length
        ? '<small class="origin">Uit eigen recept(en): ' +
          uniqueRecipes.slice(0, 4).map(htmlText).join(', ') +
          (uniqueRecipes.length > 4 ? ' (+' + (uniqueRecipes.length - 4) + ' meer)' : '') +
          '</small>'
        : ''
      return '<tr>' +
        '<td class="need"><span class="number">CSV ' + rowNumber + '</span>' +
        '<strong>' + htmlText(need.label) + '</strong>' +
        '<small>Benodigd: ' + htmlText(physical) + '</small>' + origins + '</td>' +
        '<td class="write"></td><td class="write"></td><td class="write"></td>' +
        '</tr>'
    }).join('\n')
    return '<section class="store">' +
      '<h2>' + store + '</h2>' +
      '<p><strong>Echte datum/tijd met UTC-offset of Z:</strong> ' +
      '<span class="blank">_______________________________________</span></p>' +
      '<p><strong>Eigen rechtmatige bron / winkel / context:</strong> ' +
      '<span class="blank">_______________________________________</span></p>' +
      '<table><thead><tr><th>Planner-behoefte / CSV-regel</th>' +
      '<th>Originele productnaam en broncode</th>' +
      '<th>Gemeten verpakking, inhoud en multipack</th>' +
      '<th>Werkelijke pakprijs (€) / beschikbaar?</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<p class="disclaimer">Niet gevonden? Laat de bronvelden leeg. ' +
      'Een oningevulde rij is geen geprijsd product.</p></section>'
  }).join('\n')

  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; connect-src 'none'">
<title>SUPA · persoonlijk prijsopnameformulier</title>
<style>
@page { size: A4; margin: 13mm; }
* { box-sizing: border-box; }
body { max-width: 1100px; margin: 0 auto; padding: 26px; color: #181818; font: 15px/1.4 system-ui, Arial, sans-serif; }
h1 { margin: 0 0 6px; font-size: 26px; }
h2 { border-bottom: 2px solid #111; padding-bottom: 7px; margin-top: 20px; }
p { margin: 8px 0; }
.notice { padding: 12px; border: 2px solid #111; margin: 15px 0; }
.store { break-before: page; }
.store:first-of-type { break-before: auto; }
.blank { display: inline-block; min-width: 260px; letter-spacing: 1px; }
table { width: 100%; border-collapse: collapse; margin-top: 14px; table-layout: fixed; font-size: 12px; }
th, td { border: 1px solid #777; padding: 7px; text-align: left; vertical-align: top; }
th:first-child { width: 31%; } th:nth-child(2) { width: 27%; } th:nth-child(3) { width: 23%; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
td { height: 70px; }
.need strong { display: block; font-size: 13px; overflow-wrap: anywhere; }
.need small { display: block; margin-top: 3px; }
.number { display: block; font-size: 11px; }
.disclaimer { font-size: 12px; }
@media print { body { padding: 0; max-width: none; font-size: 12px; } .notice { border-width: 1px; } }
</style>
</head>
<body>
<h1>SUPA · persoonlijke prijsopname</h1>
<p>Dit formulier hoort bij het door jou gekozen Planner-weekmenu.</p>
<div class="notice"><strong>Leeg formulier, géén bewijs van winkelprijzen of besparing.</strong>
Noteer uitsluitend werkelijk geobserveerde originele bronartikelen, verpakkingen,
beschikbaarheid en prijzen die je rechtmatig mag vastleggen. Vul dezelfde echte
waarnemingstijd per winkel in het digitale CSV-bestand in. UTC-Z (YYYY-MM-DDTHH:mm:ssZ) is geldig;
verzin geen bronmoment of prijs. Een onbekende prijs is nooit €0.
Voor een privé-tweewinkelverschil zijn twee complete recente mandjes en jouw bronbevestiging vereist.</div>
${sections}
</body>
</html>`
}
