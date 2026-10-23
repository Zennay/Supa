import { literalCsv } from '../../privateBasketComparisonCsv.ts'
import { readableRecipeShoppingAmount, type OwnRecipeChecklist } from './recipeShoppingChecklist.ts'

/** User-owned, unpriced checklist. Never emit a synthetic product or retail price. */
export function exportOwnRecipeChecklistCsv(
  checklist: OwnRecipeChecklist, checked: Readonly<Record<string, boolean>>,
): string {
  if (!checklist.canCopy || !checklist.lines.length || checklist.lines.length > 80) {
    throw new Error('Dit recept heeft geen geschikte boodschappen om te exporteren.')
  }
  const encode = (fields: readonly unknown[]) => fields.map(value => literalCsv(value)).join(';')
  const rows = [
    encode(['Recept', checklist.recipeCount ? 'Aantal recepten' : 'Porties', 'Origineel ingrediënt', 'Naam', 'Hoeveelheid', 'Eenheid',
      'Controle', 'Afgevinkt', 'Prijs']),
    ...checklist.lines.map(line => encode([
      checklist.title,
      String(checklist.recipeCount ?? checklist.portions),
      line.original,
      line.label,
      line.needsReview || line.amount === null ? '' : readableRecipeShoppingAmount(line.amount),
      line.needsReview ? '' : line.unit === 'piece' ? 'stuks' : line.unit ?? '',
      line.needsReview ? 'Handmatig beoordelen' : 'Metrisch gecontroleerd',
      checked[line.key] === true ? 'ja' : 'nee',
      'Onbekend',
    ])),
  ].join('\r\n') + '\r\n'
  if (new TextEncoder().encode(rows).length > 256_000) {
    throw new Error('De ongeprijsde boodschappenlijst is te groot voor CSV.')
  }
  return rows
}
