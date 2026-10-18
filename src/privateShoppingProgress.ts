/**
 * Explicit, portable, device-local shopping tick backup. The saved file has
 * no authority for price, product match, availability or capture freshness.
 * Restore only against an independently reconstructed CURRENT live basket.
 */
import type { OneStoreBasket } from './domain/basket.ts'
export type TripKey = {
  schema: 'supa-private-shopping-progress-v1'
  store: string
  observedAt: string
  selectedMealCount: number
  totalCents: number
  lines: string[]
}
type SavedTrip = TripKey & { checked: string[] }
const keys = ['schema', 'store', 'observedAt', 'selectedMealCount', 'totalCents', 'lines', 'checked']
const maxBytes = 256000

export function currentTripKey(basket: OneStoreBasket, observedAt: string): TripKey | null {
  if (!basket || !basket.lines.length || basket.unresolvedLineCount !== 0 ||
      basket.matchedLineCount !== basket.lines.length || !observedAt ||
      !basket.lines.every(line => line.status === 'matched')) return null
  return {
    schema: 'supa-private-shopping-progress-v1',
    store: basket.store.id,
    observedAt,
    selectedMealCount: basket.selectedMealCount,
    totalCents: basket.totalCents,
    lines: basket.lines.map(line => {
      if (line.status !== 'matched') throw Error('Ongeldige mandregel')
      // Never use a display-only unit price as the monetary authority.
      return JSON.stringify([
        line.id, line.ingredientLabel, line.requirement.amount, line.requirement.unit,
        line.productId, line.productName, line.packs, line.pack.amount,
        line.pack.unit, line.pack.count, line.pricePerPackCents, line.lineTotalCents,
      ])
    }),
  }
}
export function saveTripProgress(key: TripKey, checked: ReadonlySet<string>, basket: OneStoreBasket): string {
  const ids = basket.lines.map(line => line.id)
  const data: SavedTrip = { ...key, checked: ids.filter(id => checked.has(id)) }
  const json = JSON.stringify(data, null, 2) + '\n'
  if (new TextEncoder().encode(json).length > maxBytes) throw Error('Afvinkbestand is te groot')
  return json
}
export function loadTripProgress(text: string, live: TripKey, basket: OneStoreBasket): Set<string> {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > maxBytes) throw Error('Te groot')
  const data: unknown = JSON.parse(text)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Ongeldige voortgang')
  const saved = data as Record<string, unknown>
  if (Object.keys(saved).length !== keys.length ||
      Object.keys(saved).some(key => !keys.includes(key)) ||
      !Array.isArray(saved.checked) || saved.checked.length > basket.lines.length) throw Error('Ongeldige voortgang')
  for (const field of keys.filter(key => key !== 'checked')) {
    if (JSON.stringify(saved[field]) !== JSON.stringify(live[field as keyof TripKey])) {
      throw Error('Afvinkbestand hoort bij een andere winkelmand of andere bronopname')
    }
  }
  const ids = new Set(basket.lines.map(line => line.id))
  const done = new Set<string>()
  for (const id of saved.checked) {
    if (typeof id !== 'string' || !ids.has(id) || done.has(id)) {
      throw Error('Afvinkbestand heeft onbekende of dubbele ingrediënten')
    }
    done.add(id)
  }
  return done
}
