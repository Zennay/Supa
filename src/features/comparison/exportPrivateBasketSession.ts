import { aggregatePlanIngredients, type RecipeWithIngredients } from '../../domain/basket.ts'
import { parseOfflinePriceSnapshots } from '../../domain/offlineReviewedImport.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import { exportPrivatePlannerWeek } from './exportPrivatePlannerWeek.ts'

type Store = 'PLUS' | 'DekaMarkt'
type Selected = Readonly<Record<Store, Readonly<Record<string, string>>>>
const stores: Store[] = ['PLUS', 'DekaMarkt']
const MAX_BYTES = 256000
const family = (unit: string) => unit === 'g' || unit === 'kg' ? 'mass'
  : unit === 'ml' || unit === 'l' ? 'volume' : unit === 'piece' ? 'piece' : 'unknown'

/**
 * Directly interoperable with the existing /private-basket-mapping.html
 * session importer. This file transports private original observations and
 * explicitly chosen SKU identity, never an attestation of source permission,
 * freshness, independent review or a calculated price advantage.
 */
export function exportPrivateBasketSession(input: {
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
  rawSource: string
  selected: Selected
}): string {
  // The portable week exporter already checks recipe IDs, metric quantities,
  // unique selected days and physical demands. Do not create a second parser.
  exportPrivatePlannerWeek(input.plan, input.recipes, input.activeDays)
  const source = JSON.parse(input.rawSource) as unknown
  const accepted = parseOfflinePriceSnapshots(input.rawSource, Date.now())
  const needs = aggregatePlanIngredients(input.plan, input.recipes, input.activeDays)
  if (!needs.length || needs.length > 200) {
    throw new Error('Privémandvraag moet 1–200 fysieke ingrediënten bevatten.')
  }
  const chosen = new Map<Store, Map<string, string>>()
  for (const store of stores) {
    const verified = new Map<string, string>()
    const capture = accepted.captures[store]
    for (const need of needs) {
      const id = input.selected[store]?.[need.id]
      if (typeof id !== 'string' || !id) continue
      const product = capture?.products.find(item => item.id === id)
      if (!product || !product.available || product.packAmount === null ||
          family(product.packUnit) !== family(need.unit)) {
        // Stale or mismatched selections MUST NOT travel as source matches.
        throw new Error('Gekozen SKU is geen geldig artikel uit deze eigen winkelopname.')
      }
      verified.set(need.id, id)
    }
    chosen.set(store, verified)
  }
  const demand = {
    schema: 'supa-private-basket-demand-v1',
    selectedMealCount: input.activeDays.length,
    ingredients: needs.map(need => ({
      id: need.id, label: need.label, amount: need.amount, unit: need.unit,
      productIds: Object.fromEntries(stores.map(store => {
        const matches = chosen.get(store)!
        const sku = matches.get(need.id)
        // Two different ingredients may not each buy the same entire package
        // as a separate purchase; demand consolidation is a human operation.
        const repeated = sku && [...matches.values()].filter(v => v === sku).length > 1
        return [store, sku && !repeated ? sku : null]
      })),
    })),
  }
  const json = JSON.stringify({
    schema: 'supa-private-basket-session-v1',
    source,
    demand,
  }, null, 2) + '\n'
  if (new TextEncoder().encode(json).byteLength > MAX_BYTES) {
    throw new Error('Privésessie is groter dan 256 kB. Bewaar bron en weekmenu afzonderlijk.')
  }
  return json
}
