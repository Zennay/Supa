import { aggregatePlanIngredients, type RecipeWithIngredients } from '../../domain/basket.ts'
import { parseOfflinePriceSnapshots } from '../../domain/offlineReviewedImport.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import { exportPrivatePlannerWeek } from './exportPrivatePlannerWeek.ts'
type Store = 'PLUS' | 'DekaMarkt'
const stores: Store[] = ['PLUS', 'DekaMarkt']
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
const family = (u: string) => u === 'g' || u === 'kg' ? 'mass'
  : u === 'ml' || u === 'l' ? 'volume' : u === 'piece' ? 'piece' : 'unknown'
/** Restore a portable private session into the exact current Planner demand.
 * Review flags and trip ticks are NEVER proof and are not restored.
 */
export function importPrivateBasketSession(input: {
  text: string; plan: PlannedMeal[]; recipes: RecipeWithIngredients[];
  activeDays: string[]; now: number
}) {
  if (!input.text || new TextEncoder().encode(input.text).byteLength > 256000)
    throw Error('Privésessie is leeg of groter dan 256 kB.')
  exportPrivatePlannerWeek(input.plan, input.recipes, input.activeDays)
  const root: unknown = JSON.parse(input.text)
  if (!record(root) || Object.keys(root).sort().join(',') !== 'demand,schema,source' ||
      root.schema !== 'supa-private-basket-session-v1') throw Error('Ongeldig privésessieformaat.')
  const rawSource = JSON.stringify(root.source)
  const captured = parseOfflinePriceSnapshots(rawSource, input.now)
  const needs = aggregatePlanIngredients(input.plan, input.recipes, input.activeDays)
  const demand = root.demand
  if (!record(demand) || Object.keys(demand).sort().join(',') !== 'ingredients,schema,selectedMealCount' ||
      demand.schema !== 'supa-private-basket-demand-v1' ||
      demand.selectedMealCount !== input.activeDays.length ||
      !Array.isArray(demand.ingredients) || demand.ingredients.length !== needs.length ||
      needs.length > 200) throw Error('Privésessie hoort niet bij dit weekmenu.')
  const known = new Map(needs.map(item => [item.id, item]))
  const seen = new Set<string>()
  const selected: Record<Store, Record<string, string>> = { PLUS: {}, DekaMarkt: {} }
  for (const item of demand.ingredients) {
    if (!record(item) || Object.keys(item).sort().join(',') !==
        'amount,id,label,productIds,unit' || typeof item.id !== 'string' ||
        seen.has(item.id) || !record(item.productIds) ||
        Object.keys(item.productIds).some(key => !stores.includes(key as Store))) {
      throw Error('Privésessie bevat ongeldige of dubbele ingrediënten.')
    }
    const actual = known.get(item.id)
    if (!actual || item.label !== actual.label ||
        item.unit !== actual.unit || item.amount !== actual.amount)
      throw Error('Huidige weekvraag is anders; oude productkoppelingen zijn ingetrokken.')
    seen.add(item.id)
    for (const store of stores) {
      const id = item.productIds[store]
      if (id === null || id === undefined) continue
      if (typeof id !== 'string' || !id || id.length > 100)
        throw Error('Ongeldige bronartikelcode in de privésessie.')
      const found = captured.captures[store]?.products.filter(product => product.id === id)
      const product = found?.[0]
      if (found?.length !== 1 || !product || !product.available ||
          product.packAmount === null || family(product.packUnit) !== family(actual.unit))
        throw Error('Een productcode hoort niet bij de huidige eigen bron.')
      if (Object.values(selected[store]).includes(id))
        throw Error('Dezelfde bronverpakking wordt ten onrechte dubbel gekocht.')
      selected[store][item.id] = id
    }
  }
  return { rawSource, captured, selected }
}
