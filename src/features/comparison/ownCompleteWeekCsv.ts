import { aggregatePlanIngredients, type RecipeWithIngredients } from '../../domain/basket.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import { literalCsv } from '../../privateBasketComparisonCsv.ts'
import type { OwnExtraGrocery } from './ownExtraGroceriesCsv.ts'

const physicalKey = (item: { id: string; label: string; amount: number | null; unit: string }) =>
  JSON.stringify([item.id, item.label, item.amount, item.unit])

/** Complete physical shopping demand. No retailer prices or invented matches. */
export function exportOwnCompleteWeekCsv(
  plan: PlannedMeal[], recipes: RecipeWithIngredients[], activeDays: string[],
  extras: readonly OwnExtraGrocery[],
  plannerTicks: Readonly<Record<string, boolean>> | null = {},
): string {
  const demand = activeDays.length ? aggregatePlanIngredients(plan, recipes, activeDays) : []
  if (demand.length + extras.length === 0 || demand.length > 2000 || extras.length > 100)
    throw new Error('Geen geldig fysiek weekmandje of te veel artikelen.')
  const row = (fields: readonly unknown[]) => fields.map(value => literalCsv(value)).join(';')
  const csv = [
    row(['Herkomst', 'Ingrediënt-ID', 'Artikel', 'Fysieke hoeveelheid', 'Eenheid',
      'Afgevinkt', 'Productkoppeling', 'Prijsstatus']),
    ...demand.map(item => row(['Planner-recept', item.id, item.label,
      item.amount === null ? '' : String(item.amount), item.unit,
      plannerTicks === null ? 'Onbekend' :
        plannerTicks[physicalKey(item)] === true ? 'ja' : 'nee',
      'Niet gekoppeld', 'Onbekend'])),
    ...extras.map(item => row(['Eigen extra', item.id, item.name, String(item.quantity),
      item.unit === 'piece' ? 'stuks' : item.unit, item.done ? 'ja' : 'nee',
      'Niet gekoppeld', 'Onbekend'])),
  ].join('\r\n') + '\r\n'
  if (new TextEncoder().encode(csv).length > 256000)
    throw new Error('Weekmandje is te groot voor een veilige CSV-export.')
  return csv
}


/** Human-readable mobile list; never inherits a shop price or fake receipt. */
export function ownCompleteWeekText(
  plan: PlannedMeal[], recipes: RecipeWithIngredients[], activeDays: string[],
  extras: readonly OwnExtraGrocery[],
  plannerTicks: Readonly<Record<string, boolean>> | null = {},
): string {
  const demand = activeDays.length ? aggregatePlanIngredients(plan, recipes, activeDays) : []
  if (!demand.length && !extras.length) throw new Error('Geen boodschappen in dit weekmenu.')
  if (demand.length > 2000 || extras.length > 100)
    throw new Error('Te veel fysieke artikelen voor een leesbare weeklijst.')
  const clean = (value: string) => value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim()
  const amount = (value: number | null, unit: string) => value === null
    ? 'hoeveelheid controleren (' + clean(unit) + ')'
    : String(value).replace('.', ',') + ' ' + (unit === 'piece' ? 'stuks' : clean(unit))
  const list = [
    'Supa - mijn complete weekboodschappen zonder winkelprijzen',
    '',
    'INGREDIËNTEN UIT PLANNER (' + demand.length + ')',
    ...demand.map(item => (plannerTicks === null ? '? ' :
      plannerTicks[physicalKey(item)] === true ? '☑ ' : '☐ ') +
      clean(item.label) + ' - ' + amount(item.amount, item.unit)),
    '',
    'EIGEN EXTRA BOODSCHAPPEN (' + extras.length + ')',
    ...extras.map(item => (item.done ? '☑ ' : '☐ ') +
      clean(item.name) + ' - ' + amount(item.quantity, item.unit)),
    '',
    'Geen winkelprijzen bekend voor deze export. Geen geverifieerde besparing.',
  ].join('\n')
  if (list.length > 120000) throw new Error('De weeklijst is te lang om te delen.')
  return list
}
