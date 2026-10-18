import { compareFullBaskets } from '../../domain/basketComparison.ts'
import type { BasketTraceLine, OneStoreBasket } from '../../domain/basket.ts'

export type MixedStore = 'PLUS' | 'DekaMarkt'
export type MixedStoreLine = {
  id: string
  ingredientLabel: string
  amount: number
  unit: string
  store: MixedStore
  productId: string
  productName: string
  packs: number
  packAmount: number
  packUnit: string
  packCount: number
  pricePerPackCents: number
  lineTotalCents: number
  otherStoreLineTotalCents: number
  key: string
}
export type MixedStoreShoppingPlan = {
  lines: MixedStoreLine[]
  totalCents: number
  totals: Record<MixedStore, number>
  cheapestWholeStoreCents: number
  additionalDifferenceCents: number
  plusWholeCents: number
  dekaWholeCents: number
}

/** A mixed shopping trip is only possible when the EXISTING trusted physical
 * basket comparison admits two complete, identical demands. No source data,
 * review, permission, retailer price or timestamp is manufactured here.
 * The calling UI must additionally require currently reviewed, fresh sources.
 */
export function createMixedStoreShoppingPlan(
  plus: OneStoreBasket,
  deka: OneStoreBasket,
  mode: 'mixed' | 'single' = 'mixed',
  preferred: Readonly<Record<string, MixedStore>> = {},
): MixedStoreShoppingPlan | null {
  if (plus.store.id !== 'PLUS' || deka.store.id !== 'DekaMarkt') return null
  const comparison = compareFullBaskets({ baseline: plus, candidate: deka })
  if (!comparison.claimable || comparison.deltaCents === null ||
      comparison.lineDeltas.length !== plus.lines.length ||
      comparison.lineDeltas.length !== deka.lines.length) return null
  const allowed = new Set(comparison.lineDeltas.map(line => line.id))
  // A changed Planner week can remove ingredient IDs. Old UI preferences for
  // now-absent IDs must not make the new verified week unusable. Ignore those
  // orphaned preferences; the current basket only applies choices for its
  // exact known ingredient IDs. Never admit an invalid *active* store choice.
  if (Object.entries(preferred).some(([id, store]) =>
    allowed.has(id) && store !== 'PLUS' && store !== 'DekaMarkt')) return null
  const byStore = (basket: OneStoreBasket) =>
    new Map(basket.lines.filter((line): line is Extract<BasketTraceLine, {status: 'matched'}> =>
      line.status === 'matched').map(line => [line.id, line]))
  const plusById = byStore(plus)
  const dekaById = byStore(deka)
  const totals: Record<MixedStore, number> = { PLUS: 0, DekaMarkt: 0 }
  const lines: MixedStoreLine[] = []
  for (const delta of comparison.lineDeltas) {
    const a = plusById.get(delta.id)
    const b = dekaById.get(delta.id)
    if (!a || !b || a.lineTotalCents !== delta.baselineLineTotalCents ||
        b.lineTotalCents !== delta.candidateLineTotalCents) return null
    // Deterministic tie -> PLUS; a mixed itinerary never needs a second shop
    // when every ingredient can be bought for the same total at one shop.
    const store: MixedStore = mode === 'single'
      ? (deka.totalCents < plus.totalCents ? 'DekaMarkt' : 'PLUS')
      : preferred[delta.id] ?? (b.lineTotalCents < a.lineTotalCents ? 'DekaMarkt' : 'PLUS')
    const picked = store === 'PLUS' ? a : b
    const other = store === 'PLUS' ? b : a
    const next = totals[store] + picked.lineTotalCents
    if (!Number.isSafeInteger(next) || next < 0) return null
    totals[store] = next
    lines.push({
      id: picked.id, ingredientLabel: picked.ingredientLabel,
      amount: picked.requirement.amount, unit: picked.requirement.unit,
      store, productId: picked.productId, productName: picked.productName,
      packs: picked.packs, packAmount: picked.pack.amount,
      packUnit: picked.pack.unit, packCount: picked.pack.count,
      pricePerPackCents: picked.pricePerPackCents,
      lineTotalCents: picked.lineTotalCents,
      otherStoreLineTotalCents: other.lineTotalCents,
      key: JSON.stringify([
        store, picked.id, picked.requirement.amount, picked.requirement.unit,
        picked.productId, picked.productName, picked.pack.amount, picked.pack.unit,
        picked.pack.count, picked.packs, picked.pricePerPackCents, picked.lineTotalCents,
      ]),
    })
  }
  const totalCents = totals.PLUS + totals.DekaMarkt
  const cheapestWholeStoreCents = Math.min(plus.totalCents, deka.totalCents)
  const additionalDifferenceCents = cheapestWholeStoreCents - totalCents
  if (!Number.isSafeInteger(totalCents) || !Number.isSafeInteger(additionalDifferenceCents) ||
      totalCents < 0 || lines.length === 0) return null
  return {
    lines, totalCents, totals, cheapestWholeStoreCents,
    additionalDifferenceCents, plusWholeCents: plus.totalCents,
    dekaWholeCents: deka.totalCents,
  }
}

export function formatMixedStoreShoppingPlan(
  plan: MixedStoreShoppingPlan,
  captured: Record<MixedStore, string>,
  done: Readonly<Record<string, boolean>> = {},
  extraVisitCostCents: number | null = null,
): string {
  const money = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
  const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, ' ')
  return [
    'SUPA · mijn persoonlijke twee-winkel-boodschappenroute',
    'Alleen zelf ingevoerde, persoonlijk bevestigde prijsopnames.',
    'Geen actuele live winkelprijzen, bronrechten of onafhankelijk besparingsbewijs.',
    'Reiskosten, tijd en eventuele winkelkortingen zijn NIET meegenomen.',
    'PLUS opname: ' + clean(captured.PLUS),
    'DekaMarkt opname: ' + clean(captured.DekaMarkt),
    '',
    'PLUS hele mand: ' + money.format(plan.plusWholeCents / 100),
    'DekaMarkt hele mand: ' + money.format(plan.dekaWholeCents / 100),
    'Goedkoopste volledige winkel: ' + money.format(plan.cheapestWholeStoreCents / 100),
    'Gekozen boodschappenroute, uitsluitend artikelen: ' + money.format(plan.totalCents / 100),
    'Rekenkundig verschil t.o.v. goedkoopste enkele winkel, zonder extra ritkosten: ' +
      money.format(plan.additionalDifferenceCents / 100),
    ...((plan.lines.some(line => line.store === 'PLUS') && plan.lines.some(line => line.store === 'DekaMarkt'))
      ? [extraVisitCostCents === null
        ? 'Extra bezoekkosten: niet opgegeven; werkelijk financieel voordeel onbekend.'
        : 'Zelf opgegeven extra bezoekkosten: ' + money.format(extraVisitCostCents / 100),
        ...(extraVisitCostCents === null ? [] : [
          'Twee-winkelroute inclusief zelf opgegeven extra kosten: ' +
            money.format((plan.totalCents + extraVisitCostCents) / 100),
          'Verschil t.o.v. goedkoopste enkele winkel na deze extra kosten: ' +
            money.format((plan.additionalDifferenceCents - extraVisitCostCents) / 100),
        ])]
      : ['Deze gekozen route bezoekt maar één winkel; geen extra tweede bezoek.']),
    ...(['PLUS','DekaMarkt'] as const).flatMap(store => [
      '',
      store + ' · ' + money.format(plan.totals[store] / 100),
      ...plan.lines.filter(item => item.store === store).map(item =>
        (done[item.key] ? '[x] ' : '[ ] ') +
        clean(item.ingredientLabel) + ': ' + item.amount + ' ' + item.unit +
        ' → ' + item.packs + ' x ' + clean(item.productName) +
        ' [broncode ' + clean(item.productId) + ']' +
        ' (' + item.packCount + ' x ' + item.packAmount + ' ' + item.packUnit +
        ' per pak) · ' + money.format(item.pricePerPackCents / 100) +
        '/pak · ' + money.format(item.lineTotalCents / 100)),
    ]),
    '',
    'Uitsluitend een lokale rekenhulp; nieuwe bronopnames of productkeuzes vereisen nieuwe controles.',
  ].join('\n')
}
