import type { CombinedImportedGroceries } from './combinedImportedRecipeGroceries.ts'
import type { RecipeWeekAssignment } from './exportRecipeWeekPrint.ts'
import { formatOwnRecipeChecklist, readableRecipeShoppingAmount } from './recipeShoppingChecklist.ts'
import { sumDecimalAmounts } from '../../domain/decimalPackArithmetic.ts'
import { literalCsv } from '../../privateBasketComparisonCsv.ts'

/** Privacy-safe day attribution from already-reviewed original recipe rows.
 * This is shopping provenance, never an automatic stock or retailer match. */
type DayLine = {
  line: CombinedImportedGroceries['checklist']['lines'][number]
  sources: { source: CombinedImportedGroceries['contributorsByLine'][string][number]; day: string }[]
}

/** Both exports rely on one canonical original-demand and contribution check. */
function admittedDayLines(result: CombinedImportedGroceries,
  assignments: readonly RecipeWeekAssignment[]): DayLine[] {
  if (!result.complete || !result.checklist.canCopy ||
      !assignments.length || assignments.length > 7 ||
      new Set(assignments.map(row => row.day)).size !== assignments.length ||
      new Set(assignments.map(row => row.recipeId)).size !== assignments.length ||
      assignments.length !== result.recipes)
    throw new Error('Kies voor alle gecontroleerde recepten verschillende weekdagen.')
  const assigned = new Map(assignments.map(row => [row.recipeId, row.day]))
  return result.checklist.lines.map(line => {
    if (line.needsReview || line.amount === null || !Number.isFinite(line.amount) ||
        line.amount <= 0 || !line.unit)
      throw new Error('Controleer eerst de ontbrekende fysieke hoeveelheden.')
    const entries = result.contributorsByLine[line.key]
    if (!entries?.length) throw new Error('Een ingrediënt mist de oorspronkelijke receptherkomst.')
    const sources = entries.map(source => {
      const day = assigned.get(source.recipeId)
      if (!day || source.amount === null || !Number.isFinite(source.amount) ||
          source.amount <= 0 || source.unit !== line.unit)
        throw new Error('Een ingrediëntbijdrage heeft geen gecontroleerde weekdag of hoeveelheid.')
      return { source, day }
    })
    const total = sumDecimalAmounts(sources.map(({ source }) => source.amount!))
    if (total === null || total !== line.amount)
      throw new Error('De originele receptbijdragen tellen niet op tot de fysieke weekvraag.')
    return { line, sources }
  })
}

export function formatRecipeWeekShoppingByDay(
  result: CombinedImportedGroceries, assignments: readonly RecipeWeekAssignment[],
): string {
  const admitted = admittedDayLines(result, assignments)
  const safe = (s: string) => s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim()
  const lines: string[] = [
    'SUPA · VOLLEDIG WEEKMANDJE PER KOOKDAG · ONGEPRIJSD',
    formatOwnRecipeChecklist(result.checklist, {}, false), '',
    'HERKOMST PER FYSIEKE BOODSCHAPPENREGEL',
    'De totale hoeveelheden hierboven zijn leidend. Onderstaande regels tonen het gebruik per eigen recept;',
    'ze worden NIET opnieuw opgeteld als winkelvoorraad of winkelprijzen.',
  ]
  for (const { line, sources } of admitted) {
    lines.push('', safe(line.label) + ' · totaal ' + readableRecipeShoppingAmount(line.amount!) + ' ' +
      (line.unit === 'piece' ? 'stuks' : line.unit))
    for (const { source, day } of sources) {
      lines.push('  - ' + safe(day) + ' · ' + safe(source.recipeTitle) +
        ': ' + readableRecipeShoppingAmount(source.amount!) + ' ' +
        (source.unit === 'piece' ? 'stuks' : source.unit) +
        ' (' + safe(source.original) + ')')
    }
  }
  lines.push('', 'Gecombineerde behoeften zijn geen verpakkingen. SKU, beschikbaarheid,')
  lines.push('winkelprijzen en mogelijke besparing blijven onbekend.')
  const text = lines.join('\n')
  if (new TextEncoder().encode(text).length > 256_000)
    throw new Error('De boodschappenherkomst is te groot voor een privébestand.')
  return text
}

/** Spreadsheet-friendly, private recipe-day breakdown. Only total rows are
 * shopping demand. Contributions explain the same physical quantities and
 * must never be summed a second time as purchases or priced products. */
export function exportRecipeWeekShoppingByDayCsv(
  result: CombinedImportedGroceries,
  assignments: readonly RecipeWeekAssignment[],
): string {
  const admitted = admittedDayLines(result, assignments)
  const row = (fields: readonly unknown[]) => fields.map(value => literalCsv(value)).join(';')
  const csv = [
    row(['Soort', 'Fysieke vraag', 'Ingrediënt', 'Kookdag', 'Eigen recept',
      'Oorspronkelijke regel', 'Totaal nodig', 'Bijdrage recept',
      'Eenheid', 'Winkelproduct', 'Prijs', 'Toelichting']),
    ...admitted.flatMap(({ line, sources }) => [
      row(['Totaal - eenmalig kopen', line.query ?? '', line.label, '', '', '',
        readableRecipeShoppingAmount(line.amount!), '',
        line.unit === 'piece' ? 'stuks' : line.unit,
        'Niet gekoppeld', 'Onbekend',
        'Gehele fysieke behoefte; geen winkelprijs of verpakking bekend']),
      ...sources.map(({ source, day }) => row([
        'Receptbijdrage - NIET apart kopen', line.query ?? '', line.label,
        day, source.recipeTitle, source.original, '',
        readableRecipeShoppingAmount(source.amount!),
        source.unit === 'piece' ? 'stuks' : source.unit,
        'Niet gekoppeld', 'Onbekend',
        'Al inbegrepen in de bovenstaande Totaal-regel',
      ])),
    ]),
  ].join('\r\n') + '\r\n'
  if (new TextEncoder().encode(csv).length > 256_000)
    throw new Error('De week-CSV is te groot. Selecteer minder recepten.')
  return csv
}
