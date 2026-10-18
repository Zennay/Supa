import type { OneStoreBasket } from '../../domain/basket.ts'
import { buildShoppingListCopyText } from './shoppingListCopyText.ts'
import { shoppingListBasketKey } from './shoppingListProgress.ts'
import type { UnpricedShoppingNote } from './ManualShoppingNotes.tsx'

export type PrivateLooseProduct = Readonly<{
  name: string
  packs: number
  done: boolean
}>

/**
 * One portable trip assembled exclusively from the user's current, admitted
 * basket and own notes. Hand-authored extras NEVER affect the whole-basket
 * cents, weekly budget, or a second retailer's comparison.
 */
export function combinedPrivateTripText({
  basket, store, sourceFresh, notes, extras = [],
}: {
  basket: OneStoreBasket | null
  store: 'PLUS' | 'DekaMarkt'
  sourceFresh: boolean
  notes: readonly UnpricedShoppingNote[]
  extras?: readonly PrivateLooseProduct[]
}): string | null {
  if (!['PLUS', 'DekaMarkt'].includes(store) ||
      !Array.isArray(notes) || notes.length > 100 ||
      !Array.isArray(extras) || extras.length > 1000) return null
  const allowedNotes = notes.filter(note => note.store === 'Algemeen' || note.store === store)
  if (allowedNotes.some(note => typeof note.id !== 'string' ||
      typeof note.label !== 'string' || !note.label.trim() ||
      note.label.length > 140 || typeof note.done !== 'boolean')) return null
  if (extras.some(item => !item || typeof item.name !== 'string' ||
      !item.name.trim() || item.name.length > 160 ||
      !Number.isSafeInteger(item.packs) || item.packs < 1 ||
      item.packs > 99 || typeof item.done !== 'boolean')) return null
  if (basket && (basket.store?.id !== store || basket.store.name !== store)) return null
  if (basket) {
    try { shoppingListBasketKey(basket) }
    catch { return null }
  }
  const priced = basket ? buildShoppingListCopyText(basket) : null
  if (basket && priced === null) return null
  if (!priced && !extras.length && !allowedNotes.length) return null
  const safe = (text: string) => text
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ')
    .replace(/\s+/gu, ' ').trim()
  return [
    'SUPA · MIJN COMPLETE PRIVÉWINKELLIJST · ' + store,
    'Gemaakt uit mijn eigen weekmenu en eigen aangevulde artikelen.',
    priced ? (sourceFresh
      ? 'Winkelopname lokaal recent; prijzen blijven ongeverifieerde eigen invoer.'
      : 'WAARSCHUWING: winkelopname verouderd; geen actuele winkelprijs.') :
      'Geen winkelopname geladen; alle prijzen onbekend.',
    'Dit is geen onafhankelijke prijsgarantie of publieke besparingsclaim.',
    ...(priced ? ['', 'WEEKMENU — EIGEN PRODUCTMATCHES', priced] : []),
    ...(extras.length ? ['', 'LOSSE ZELF GEKOZEN PRODUCTEN — buiten weekmand en budget',
      ...extras.map(extra => (extra.done ? '[x] ' : '[ ] ') +
        extra.packs + ' × ' + safe(extra.name) + ' — geen onderdeel van vergelijking')] : []),
    ...(allowedNotes.length ? ['', 'EIGEN ONGEPRIJSDE BOODSCHAPPEN',
      ...allowedNotes.map(note => (note.done ? '[x] ' : '[ ] ') +
        safe(note.label) + ' [' + note.store + '] — prijs onbekend')] : []),
    '',
    'Eigen toegevoegde artikelen zijn niet bij het mandtotaal opgeteld.',
  ].join('\n') + '\n'
}
