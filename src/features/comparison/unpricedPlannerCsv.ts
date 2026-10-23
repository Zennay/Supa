import { literalCsv } from '../../privateBasketComparisonCsv.ts'
import type { aggregatePlanIngredients } from '../../domain/basket.ts'
import { readablePlannerDemandAmount } from './plannerPriceCaptureGuide.ts'

type Line = ReturnType<typeof aggregatePlanIngredients>[number]
const lineKey = (line: Line) => JSON.stringify([line.id, line.label, line.amount, line.unit])

/** Never present a physical ingredient as a priced or matched store article. */
export function exportUnpricedPlannerCsv(
  lines: readonly Line[],
  checked: Readonly<Record<string, boolean>>,
  openOnly: boolean,
): string {
  if (!lines.length || lines.length > 2000) {
    throw new Error('Er is geen geldig weekmandje om te exporteren.')
  }
  const rows = openOnly ? lines.filter(line => checked[lineKey(line)] !== true) : lines
  const csvRow = (fields: readonly unknown[]) => fields.map(field => literalCsv(field)).join(';')
  const csv = [
    csvRow(['Ingrediënt-ID', 'Ingrediënt', 'Fysieke hoeveelheid', 'Eenheid',
      'Status', 'Afgevinkt', 'Winkelproduct', 'Winkelprijs']),
    ...rows.map(line => csvRow([
      line.id, line.label,
      readablePlannerDemandAmount(line.amount) === 'hoeveelheid nog controleren'
        ? '' : readablePlannerDemandAmount(line.amount),
      line.unit,
      readablePlannerDemandAmount(line.amount) === 'hoeveelheid nog controleren' ||
      line.unit === 'unknown'
        ? 'Hoeveelheid controleren' : 'Ongeprijsde Planner-vraag',
      checked[lineKey(line)] === true ? 'ja' : 'nee', 'Niet gekoppeld', 'Onbekend',
    ])),
  ].join('\r\n') + '\r\n'
  if (new TextEncoder().encode(csv).length > 256_000) {
    throw new Error('De ongeprijsde weeklijst is te groot voor CSV.')
  }
  return csv
}
