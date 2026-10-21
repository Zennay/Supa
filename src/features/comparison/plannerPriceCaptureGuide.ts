import { makeBlankPlannerCaptureCsv, type CaptureStore, type PlannerCaptureNeed } from './plannerPriceCaptureSheet.ts'

export type PlannerCaptureGuideNeed = PlannerCaptureNeed & Readonly<{
  amount: number | null
  // Canonical Planner basket query when available, never inferred from price data.
  query?: string
}>

/**
 * Never render scientific notation or silently round a physical Planner need.
 * Values can be tiny after portions/scaling; "1e-7 g" is not a usable store
 * worksheet instruction, while a rounded "0 g" can cause underbuying.
 * This renders finite positive JS-number decimals literally, without grouping.
 */
export function readablePlannerDemandAmount(amount: number | null): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount) ||
      amount <= 0 || amount > 1_000_000) return 'hoeveelheid nog controleren'
  const raw = String(amount)
  if (!/[eE]/u.test(raw)) return raw
  const match = /^(\d+)(?:\.(\d+))?e([+-]?\d+)$/iu.exec(raw)
  if (!match) return 'hoeveelheid nog controleren'
  const digits = match[1] + (match[2] ?? '')
  const position = match[1].length + Number(match[3])
  if (position <= 0) return '0.' + '0'.repeat(-position) + digits
  if (position >= digits.length) return digits + '0'.repeat(position - digits.length)
  return digits.slice(0, position) + '.' + digits.slice(position)
}

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
    'UTC-tijdstempels met Z zijn ook geldig: YYYY-MM-DDTHH:mm:ssZ.',
    'Noteer het werkelijke bronmoment; vul NOOIT automatisch de huidige tijd in.',
    'Laat niet gevonden producten volledig oningevuld: geen prijs is niet €0.',
    'De voorgestelde eenheid is geen geobserveerde verpakking.',
    '',
    ...selectedStores.flatMap((store, storeIndex) => [
      store + ' · vul alleen deze winkel in als je een echte opname hebt',
      ...needs.map((need, index) => {
        const row = 2 + storeIndex * needs.length + index
        const amount = readablePlannerDemandAmount(need.amount)
        const quantity = amount === 'hoeveelheid nog controleren'
          ? amount : amount + ' ' + clean(need.unit)
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
