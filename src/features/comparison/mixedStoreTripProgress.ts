import type { OneStoreBasket } from '../../domain/basket.ts'
import { compareFullBaskets } from '../../domain/basketComparison.ts'
import { createMixedStoreShoppingPlan, type MixedStore, type MixedStoreShoppingPlan } from './mixedStoreShoppingPlan.ts'

export type MixedTripMode = 'auto' | 'mixed' | 'single'
export type MixedTripSettings = {
  mode: MixedTripMode
  preferred: Record<string, MixedStore>
  extraVisitCost: string
}
export type MixedTripContext = {
  plus: OneStoreBasket
  deka: OneStoreBasket
  captured: Record<MixedStore, string>
}
export type MixedTripRestore = MixedTripSettings & { checked: string[]; plan: MixedStoreShoppingPlan }

const maxBytes = 256_000
const schema = 'supa-private-mixed-trip-v1'
const required = ['schema', 'basis', 'route', 'mode', 'preferred', 'extraVisitCost', 'checked']
const own = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype
const isMode = (value: unknown): value is MixedTripMode =>
  value === 'auto' || value === 'mixed' || value === 'single'
const costCents = (value: string): number | null => {
  if (value === '') return null
  if (!/^\d{1,4}(?:[,.]\d{1,2})?$/.test(value)) throw Error('Ongeldige extra reiskosten in herstelbestand.')
  const result = Math.round(Number(value.replace(',', '.')) * 100)
  if (!Number.isSafeInteger(result) || result < 0 || result > 100_000)
    throw Error('Extra reiskosten zijn te hoog.')
  return result
}

/** This is an EXACT physical, price, timestamp and selected-meal signature.
 * Never serialize review approvals, retailer rights or an authorization claim.
 * A new observation, demand or original SKU invalidates previous checkmarks.
 */
function basis(context: MixedTripContext): string {
  const comparison = compareFullBaskets({ baseline: context.plus, candidate: context.deka })
  if (!comparison.claimable || !context.captured.PLUS || !context.captured.DekaMarkt)
    throw Error('Voor herstel zijn twee complete echte winkelmandjes nodig.')
  const summarize = (basket: OneStoreBasket) => [
    basket.store.id, basket.selectedMealCount, basket.totalCents,
    ...basket.lines.map(line => line.status === 'matched'
      ? [
          line.id, line.ingredientLabel, line.requirement.amount, line.requirement.unit,
          line.productId, line.productName, line.packs, line.pack.amount, line.pack.unit,
          line.pack.count, line.pricePerPackCents, line.lineTotalCents,
        ]
      : null),
  ]
  return JSON.stringify([
    context.captured.PLUS, context.captured.DekaMarkt,
    summarize(context.plus), summarize(context.deka),
  ])
}

/** Reconstruct from CURRENT, independently admitted and reviewed own sources.
 * The imported file chooses UI settings only, never source prices or products.
 */
function selectRoute(context: MixedTripContext, settings: MixedTripSettings) {
  const mixed = createMixedStoreShoppingPlan(context.plus, context.deka, 'mixed', settings.preferred)
  const single = createMixedStoreShoppingPlan(context.plus, context.deka, 'single')
  if (!mixed || !single) throw Error('Herstelde productvoorkeuren passen niet bij dit fysieke mandje.')
  const cost = costCents(settings.extraVisitCost)
  const suggestedSingle = mixed.additionalDifferenceCents <= 0 ||
    (cost !== null && cost >= mixed.additionalDifferenceCents)
  const useSingle = settings.mode === 'single' || (settings.mode === 'auto' && suggestedSingle)
  return useSingle ? single : mixed
}

function validSettings(value: Record<string, unknown>, context: MixedTripContext): MixedTripSettings {
  if (!isMode(value.mode) || !own(value.preferred) ||
      Object.keys(value.preferred).length > context.plus.lines.length ||
      typeof value.extraVisitCost !== 'string' || value.extraVisitCost.length > 12)
    throw Error('Ongeldige winkelroute-instellingen.')
  costCents(value.extraVisitCost)
  const allowed = new Set(context.plus.lines.map(line => line.id))
  const preferred: Record<string, MixedStore> = Object.create(null) as Record<string, MixedStore>
  for (const [id, store] of Object.entries(value.preferred)) {
    if (!allowed.has(id) || (store !== 'PLUS' && store !== 'DekaMarkt'))
      throw Error('Een winkelvoorkeur hoort niet bij dit mandje.')
    preferred[id] = store
  }
  return { mode: value.mode, preferred, extraVisitCost: value.extraVisitCost }
}

function routeKey(plan: MixedStoreShoppingPlan) {
  return JSON.stringify(plan.lines.map(line => line.key))
}

export function saveMixedTripProgress(
  context: MixedTripContext, settings: MixedTripSettings, checked: ReadonlySet<string>,
): string {
  // Prior Planner weeks can leave orphaned UI selections. They have no
  // authority over the current physical demand and must not spoil a backup.
  const currentIds = new Set(context.plus.lines.map(line => line.id))
  const activePreferred = Object.fromEntries(Object.entries(settings.preferred)
    .filter(([id]) => currentIds.has(id)))
  const selected = validSettings(
    { ...settings, preferred: activePreferred } as Record<string, unknown>, context)
  const plan = selectRoute(context, selected)
  const keys = new Set(plan.lines.map(line => line.key))
  const done = [...checked]
  if (done.some(key => !keys.has(key))) throw Error('Afvinkingen horen niet bij de gekozen winkelroute.')
  const json = JSON.stringify({
    schema, basis: basis(context), route: routeKey(plan),
    mode: selected.mode, preferred: selected.preferred,
    extraVisitCost: selected.extraVisitCost, checked: done,
  }, null, 2)
  if (new TextEncoder().encode(json).byteLength > maxBytes)
    throw Error('Het gekozen winkelmandje is te groot om lokaal te bewaren.')
  return json + '\n'
}

export function restoreMixedTripProgress(
  text: string, context: MixedTripContext,
): MixedTripRestore {
  if (typeof text !== 'string' || !text || new TextEncoder().encode(text).byteLength > maxBytes)
    throw Error('Herstelbestand ontbreekt of is groter dan 256 kB.')
  const root: unknown = JSON.parse(text)
  if (!own(root) || Object.keys(root).sort().join(',') !== [...required].sort().join(',') ||
      root.schema !== schema || typeof root.basis !== 'string' ||
      typeof root.route !== 'string' || !Array.isArray(root.checked) ||
      root.checked.length > context.plus.lines.length)
    throw Error('Dit is geen geldig winkelroute-herstelbestand.')
  if (root.basis !== basis(context))
    throw Error('Het herstelbestand heeft andere bronnen, productcodes, prijzen of een andere Planner-vraag.')
  const settings = validSettings(root, context)
  const plan = selectRoute(context, settings)
  if (root.route !== routeKey(plan))
    throw Error('De winkelroute is anders dan de bronmandjes; vinkjes zijn niet overgenomen.')
  const keys = new Set(plan.lines.map(line => line.key))
  const checked = new Set<string>()
  for (const item of root.checked) {
    if (typeof item !== 'string' || !keys.has(item) || checked.has(item))
      throw Error('Het afvinkbestand heeft dubbele of vreemde artikelen.')
    checked.add(item)
  }
  return { ...settings, checked: [...checked], plan }
}
