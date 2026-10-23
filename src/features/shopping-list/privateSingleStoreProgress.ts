import type { BasketTraceLine } from '../../domain/basket.ts'
import type { PrivateReviewedBasket, OwnStore } from '../comparison/privateReviewedBasketBridge.ts'

const schema = 'supa-private-single-shopping-progress-v1'
const maxBytes = 256_000
type Backup = { schema: string; identity: string; checked: string[] }
type Matched = Extract<BasketTraceLine, { status: 'matched' }>

/** A private, user-initiated backup; never a source import, price approval or retailer license. */
function sourceIdentity(planKey: string, store: OwnStore, capture: PrivateReviewedBasket): string {
  const basket = capture.basket
  if (!planKey || basket.store.id !== store || !capture.observedAt ||
      basket.lines.length === 0 || basket.selectedMealCount <= 0 ||
      basket.unresolvedLineCount !== 0 || basket.matchedLineCount !== basket.lines.length ||
      !Number.isSafeInteger(basket.totalCents) || basket.totalCents < 0) {
    throw Error('Geen compleet gecontroleerd winkelmandje beschikbaar.')
  }
  const seen = new Set<string>()
  let total = 0
  const lines = basket.lines.map((line): unknown[] => {
    if (line.status !== 'matched') throw Error('Nog niet alle producten zijn gecontroleerd.')
    const item: Matched = line
    if (!item.id || seen.has(item.id) ||
        !Number.isSafeInteger(item.packs) || item.packs <= 0 ||
        !Number.isSafeInteger(item.pricePerPackCents) || item.pricePerPackCents <= 0 ||
        !Number.isSafeInteger(item.lineTotalCents) || item.lineTotalCents <= 0 ||
        item.lineTotalCents !== item.packs * item.pricePerPackCents) {
      throw Error('De originele winkelmandregels zijn niet consistent.')
    }
    seen.add(item.id)
    total += item.lineTotalCents
    return [item.id, item.ingredientLabel, item.requirement.amount, item.requirement.unit,
      item.productId, item.productName, item.packs, item.pack.count, item.pack.amount,
      item.pack.unit, item.pricePerPackCents, item.lineTotalCents]
  })
  if (!Number.isSafeInteger(total) || total !== basket.totalCents)
    throw Error('De bronregels en het mandtotaal komen niet overeen.')
  return JSON.stringify([planKey, store, capture.observedAt, basket.selectedMealCount, total, lines])
}

export function exportSingleStoreProgress(args: {
  planKey: string; store: OwnStore; capture: PrivateReviewedBasket; done: ReadonlySet<string>
}): string {
  const identity = sourceIdentity(args.planKey, args.store, args.capture)
  const allowed = new Set(args.capture.basket.lines.map(line => line.id))
  if ([...args.done].some(id => !allowed.has(id))) throw Error('Ongeldige afvinkingen.')
  const json = JSON.stringify({ schema, identity, checked: [...args.done] } satisfies Backup, null, 2) + '\n'
  if (new TextEncoder().encode(json).length > maxBytes)
    throw Error('Dit winkelmandje is te groot om te bewaren.')
  return json
}

export function importSingleStoreProgress(text: string, args: {
  planKey: string; store: OwnStore; capture: PrivateReviewedBasket
}): Set<string> {
  if (typeof text !== 'string' || !text || new TextEncoder().encode(text).length > maxBytes)
    throw Error('Het herstelbestand ontbreekt of is te groot.')
  let input: unknown
  try { input = JSON.parse(text) } catch { throw Error('Het herstelbestand bevat geen geldig JSON.') }
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.getPrototypeOf(input) !== Object.prototype) throw Error('Ongeldig herstelbestand.')
  const record = input as Record<string, unknown>
  if (Object.keys(record).sort().join(',') !== ['schema', 'identity', 'checked'].sort().join(',') ||
      record.schema !== schema || typeof record.identity !== 'string' ||
      !Array.isArray(record.checked) || record.checked.length > args.capture.basket.lines.length)
    throw Error('Dit is geen Supa-afvinkbestand.')
  if (record.identity !== sourceIdentity(args.planKey, args.store, args.capture))
    throw Error('Andere winkel, weekvraag, bronmoment, producten of prijzen. Vinkjes niet overgenomen.')
  const allowed = new Set(args.capture.basket.lines.map(line => line.id))
  const checked = new Set<string>()
  for (const id of record.checked) {
    if (typeof id !== 'string' || !allowed.has(id) || checked.has(id))
      throw Error('Afvinkbestand bevat onbekende of dubbele artikelen.')
    checked.add(id)
  }
  return checked
}
