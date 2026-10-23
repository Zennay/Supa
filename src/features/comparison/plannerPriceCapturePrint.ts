import { makeBlankPlannerCaptureCsv, type CaptureStore } from './plannerPriceCaptureSheet.ts'
import { readablePlannerDemandAmount, type PlannerCaptureGuideNeed } from './plannerPriceCaptureGuide.ts'
import { captureWorksheetHtml } from './captureWorksheetText.ts'

// Only an inert local document is emitted; it never fetches external content.
const htmlText = (raw: string): string => captureWorksheetHtml(raw, 180)

type PrintableSection = Readonly<{
  store: CaptureStore
  needs: readonly PlannerCaptureGuideNeed[]
  rowStart: number
  originalRecipeLines?: readonly (readonly string[])[]
}>

function renderCaptureSections(entries: readonly PrintableSection[]): string {
  return entries.map(({ store, needs, rowStart, originalRecipeLines }) => {
    const rows = needs.map((need, index) => {
      const rowNumber = rowStart + index
      const amount = readablePlannerDemandAmount(need.amount)
      const physical = amount === 'hoeveelheid nog controleren'
        ? 'Hoeveelheid nog controleren' : amount + ' ' + need.unit
      const recipeLines = originalRecipeLines?.[index] ?? []
      const uniqueRecipes = [...new Set(recipeLines.map(line => line.trim()).filter(Boolean))]
      const origins = uniqueRecipes.length
        ? '<small class="origin">Uit oorspronkelijke receptregels: ' +
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
}

function printableDocument(sections: string, intro: string): string {
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
<p>${htmlText(intro)}</p>
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

export function makePrintablePlannerCaptureHtml(
  needs: readonly PlannerCaptureGuideNeed[],
  selectedStores: readonly CaptureStore[],
  // Optional private recipe provenance, aligned with the same canonical needs
  // order as the CSV. Never derived from retailer product names or prices.
  originalRecipeLines?: readonly (readonly string[])[],
): string {
  makeBlankPlannerCaptureCsv(needs, selectedStores)
  if (originalRecipeLines && (
    originalRecipeLines.length !== needs.length ||
    originalRecipeLines.some(lines => !Array.isArray(lines) ||
      lines.length > 1_000 || lines.some(line => typeof line !== 'string' || line.length > 2_000))
  )) throw new Error('De recept-herkomst komt niet overeen met de fysieke CSV-rijen.')
  const sections = renderCaptureSections(selectedStores.map((store, storeIndex) => ({
    store,
    needs,
    rowStart: 2 + storeIndex * needs.length,
    originalRecipeLines,
  })))
  return printableDocument(sections, 'Dit formulier hoort bij het door jou gekozen Planner-weekmenu.')
}

/**
 * Printable counterpart of the selective two-store CSV. Each retailer may have
 * a different number of missing products; row numbers must follow the exact
 * store-grouped CSV, not repeat the same Planner demand for both stores.
 */
export function makePrintableSelectivePlannerCaptureHtml(
  needsByStore: Readonly<Record<CaptureStore, readonly PlannerCaptureGuideNeed[]>>,
): string {
  if (!needsByStore || !Array.isArray(needsByStore.PLUS) ||
      !Array.isArray(needsByStore.DekaMarkt)) {
    throw new Error('De ontbrekende winkelbehoeften zijn ongeldig.')
  }
  const sections: PrintableSection[] = []
  let rowStart = 2
  for (const store of ['PLUS', 'DekaMarkt'] as const) {
    const needs = needsByStore[store]
    if (needs.length > 200) throw new Error('Maximaal 200 originele ingrediënten per winkel.')
    if (!needs.length) continue
    makeBlankPlannerCaptureCsv(needs, [store])
    sections.push({ store, needs, rowStart })
    rowStart += needs.length
  }
  if (!sections.length) throw new Error('Geen openstaande winkelproducten.')
  return printableDocument(
    renderCaptureSections(sections),
    'Dit gecombineerde formulier bevat per winkel alleen de ontbrekende producten uit jouw geselecteerde Planner-week. De rijnummers volgen het bijbehorende gecombineerde CSV-bestand.',
  )
}
