import { makeBlankPlannerCaptureCsv, type CaptureStore, type PlannerCaptureNeed } from './plannerPriceCaptureSheet.ts'

export type PlannerCaptureGuideNeed = PlannerCaptureNeed & Readonly<{
  amount: number | null
  // Canonical Planner basket query when available, never inferred from price data.
  query?: string
}>

/**
 * Printable, offline physical-demand guide matching the actual CSV row order.
 * This is never a retailer catalogue, a price source or a field observation.
 */
export function makePlannerCaptureGuide(
  needs: readonly PlannerCaptureGuideNeed[],
  selectedStores: readonly CaptureStore[],
): string {
  // Reuse the same structural/size limits as the real blank CSV export.
  makeBlankPlannerCaptureCsv(needs, selectedStores)
  const clean = (value: string) =>
    value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim().slice(0, 180)
  return [
    'SUPA · eigen prijsvastlegging voor jouw geselecteerde weekmenu',
    'Dit is GEEN winkelcatalogus, prijsopname, retailerrecht of besparingsbewijs.',
    'CSV en gids horen bij dezelfde geselecteerde Planner-week.',
    '',
    'Vul in de aparte CSV ALLEEN werkelijk waargenomen gegevens in:',
    'originele winkelproductcode, originele naam, gemeten verpakking, echte',
    'datum/tijd met expliciete UTC-offset, hele prijscenten en beschikbaarheid.',
    'Laat niet gevonden producten volledig oningevuld: geen prijs is niet €0.',
    'De voorgestelde eenheid is geen geobserveerde verpakking.',
    '',
    ...selectedStores.flatMap((store, storeIndex) => [
      store + ' · vul alleen deze winkel in als je een echte opname hebt',
      ...needs.map((need, index) => {
        const row = 2 + storeIndex * needs.length + index
        const quantity = need.amount === null || !Number.isFinite(need.amount)
          ? 'hoeveelheid onbekend' : String(need.amount) + ' ' + clean(need.unit)
        return 'CSV-regel ' + row + ' · ' + clean(need.label) + ' · nodig: ' + quantity
      }),
      '',
    ]),
    'Supa importeert alleen werkelijk ingevulde producten, vraagt per match',
    'opnieuw je bevestiging en houdt ontbrekende of verlopen prijzen onbekend.',
    'Een volledige tweewinkelvergelijking vergt twee complete actuele bronnen.',
    '',
  ].join('\n')
}
