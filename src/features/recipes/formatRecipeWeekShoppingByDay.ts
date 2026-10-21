import type { CombinedImportedGroceries } from './combinedImportedRecipeGroceries.ts'
import type { RecipeWeekAssignment } from './exportRecipeWeekPrint.ts'
import { formatOwnRecipeChecklist, readableRecipeShoppingAmount } from './recipeShoppingChecklist.ts'

/** Privacy-safe day attribution from already-reviewed original recipe rows.
 * This is shopping provenance, never an automatic stock or retailer match. */
export function formatRecipeWeekShoppingByDay(
  result: CombinedImportedGroceries,
  assignments: readonly RecipeWeekAssignment[],
): string {
  if (!result.complete || !result.checklist.canCopy ||
      !assignments.length || assignments.length > 7 ||
      new Set(assignments.map(row => row.day)).size !== assignments.length ||
      new Set(assignments.map(row => row.recipeId)).size !== assignments.length ||
      assignments.length !== result.recipes) {
    throw new Error('Kies voor alle gecontroleerde recepten verschillende weekdagen.')
  }
  const assigned = new Map(assignments.map(row => [row.recipeId, row.day]))
  const safe = (s: string) => s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim()
  const lines: string[] = [
    'SUPA · VOLLEDIG WEEKMANDJE PER KOOKDAG · ONGEPRIJSD',
    formatOwnRecipeChecklist(result.checklist, {}, false), '',
    'HERKOMST PER FYSIEKE BOODSCHAPPENREGEL',
    'De totale hoeveelheden hierboven zijn leidend. Onderstaande regels tonen het gebruik per eigen recept;',
    'ze worden NIET opnieuw opgeteld als winkelvoorraad of winkelprijzen.',
  ]
  for (const line of result.checklist.lines) {
    if (line.needsReview || line.amount === null || !Number.isFinite(line.amount) ||
        line.amount <= 0 || !line.unit)
      throw new Error('Controleer eerst de ontbrekende fysieke hoeveelheden.')
    const entries = result.contributorsByLine[line.key]
    if (!entries?.length) throw new Error('Een ingrediënt mist de oorspronkelijke receptherkomst.')
    lines.push('', safe(line.label) + ' · totaal ' + readableRecipeShoppingAmount(line.amount) + ' ' +
      (line.unit === 'piece' ? 'stuks' : line.unit))
    for (const contribution of entries) {
      const day = assigned.get(contribution.recipeId)
      if (!day || contribution.amount === null || !Number.isFinite(contribution.amount) ||
          contribution.amount <= 0 || !contribution.unit)
        throw new Error('Een ingrediëntbijdrage heeft geen gecontroleerde weekdag of hoeveelheid.')
      lines.push('  - ' + safe(day) + ' · ' + safe(contribution.recipeTitle) +
        ': ' + readableRecipeShoppingAmount(contribution.amount) + ' ' +
        (contribution.unit === 'piece' ? 'stuks' : contribution.unit) +
        ' (' + safe(contribution.original) + ')')
    }
  }
  lines.push('', 'Gecombineerde behoeften zijn geen verpakkingen. SKU, beschikbaarheid,')
  lines.push('winkelprijzen en mogelijke besparing blijven onbekend.')
  const text = lines.join('\n')
  if (new TextEncoder().encode(text).length > 256_000)
    throw new Error('De boodschappenherkomst is te groot voor een privébestand.')
  return text
}
