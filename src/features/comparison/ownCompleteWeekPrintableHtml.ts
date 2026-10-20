import type { RecipeWithIngredients } from '../../domain/basket.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import { ownCompleteWeekText } from './ownCompleteWeekCsv.ts'
import type { OwnExtraGrocery } from './ownExtraGroceriesCsv.ts'

const htmlText = (value: string) => value.replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? '')

/** Script-free, entirely offline printout of the actual private physical demand. */
export function renderOwnCompleteWeekPrintableHtml(
  plan: PlannedMeal[], recipes: RecipeWithIngredients[], activeDays: string[],
  extras: readonly OwnExtraGrocery[],
  plannerTicks: Readonly<Record<string, boolean>> | null = {},
): string {
  const plain = ownCompleteWeekText(plan, recipes, activeDays, extras, plannerTicks)
  const safe = htmlText(plain)
  const output = [
    '<!doctype html><html lang="nl"><head><meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Supa · mijn ongeprijsde boodschappen</title>',
    '<style>body{font:16px/1.55 system-ui,sans-serif;color:#163727;max-width:800px;margin:2rem auto;padding:0 1rem}',
    'h1{font-size:1.35rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:2}',
    '.note{border:1px solid #ddd;padding:.65rem;border-radius:.5rem;background:#f7faf8}',
    '@media print{body{margin:0;max-width:none;font-size:12pt}.note{border:0;padding:0}pre{line-height:1.75}}',
    '</style></head><body><h1>Supa · mijn fysieke weekboodschappen</h1>',
    '<p class="note">Privélijst voor handmatig boodschappen doen. Geen winkelprijzen of geverifieerde besparingen.</p>',
    '<pre>', safe, '</pre></body></html>',
  ].join('')
  if (new TextEncoder().encode(output).length > 256000)
    throw new Error('De afdrukbare weeklijst is te groot.')
  return output
}
