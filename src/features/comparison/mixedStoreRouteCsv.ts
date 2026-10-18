import type { BasketTraceLine, OneStoreBasket } from '../../domain/basket.ts'
import { compareFullBaskets } from '../../domain/basketComparison.ts'
import { privateUnitPrice } from './privateUnitPrice.ts'
import type { MixedStoreShoppingPlan, MixedStore } from './mixedStoreShoppingPlan.ts'
import { literalCsv } from '../../privateBasketComparisonCsv.ts'

type Matched = Extract<BasketTraceLine, { status: 'matched' }>
type Store = MixedStore

const columns = [
  'soort', 'ingredient_id', 'ingredient', 'benodigd', 'eenheid', 'gekozen_winkel',
  'gekozen_broncode', 'gekozen_product', 'gekozen_pakken',
  'gekozen_pakprijs_cent', 'gekozen_regel_cent',
  'PLUS_opname', 'PLUS_broncode', 'PLUS_product', 'PLUS_pakken',
  'PLUS_pakprijs_cent', 'PLUS_regel_cent', 'PLUS_eenheidsprijs',
  'Deka_opname', 'Deka_broncode', 'Deka_product', 'Deka_pakken',
  'Deka_pakprijs_cent', 'Deka_regel_cent', 'Deka_eenheidsprijs',
  'Deka_min_PLUS_regel_cent', 'gekocht', 'uitleg',
] as const

/** Private export of already admitted and human-reviewed own-source baskets.
 * The caller must additionally gate both capture instants and personal review.
 * It never imports, queries a retailer or produces evidence of source rights.
 */
export function exportMixedStoreRouteCsv(input: {
  plus: OneStoreBasket
  deka: OneStoreBasket
  route: MixedStoreShoppingPlan
  captured: Record<Store, string>
  checked: ReadonlySet<string>
}): string {
  const { plus, deka, route, captured, checked } = input
  if (plus.store.id !== 'PLUS' || deka.store.id !== 'DekaMarkt' ||
      typeof captured.PLUS !== 'string' || !captured.PLUS ||
      typeof captured.DekaMarkt !== 'string' || !captured.DekaMarkt)
    throw Error('De twee originele winkels of hun bronmomenten ontbreken.')
  const comparison = compareFullBaskets({ baseline: plus, candidate: deka })
  if (!comparison.claimable || !comparison.lineDeltas.length ||
      route.lines.length !== comparison.lineDeltas.length)
    throw Error('Alleen twee complete, fysiek identieke mandjes kunnen worden geëxporteerd.')
  const lineMap = (basket: OneStoreBasket) => new Map(basket.lines
    .filter((line): line is Matched => line.status === 'matched')
    .map(line => [line.id, line]))
  const p = lineMap(plus); const d = lineMap(deka)
  const seen = new Set<string>()
  const perStore = { PLUS: 0, DekaMarkt: 0 }
  const rows: string[][] = [Array.from(columns)]
  const plain = (line: Matched, observedAt: string) => [
    observedAt, line.productId, line.productName, String(line.packs),
    String(line.pricePerPackCents), String(line.lineTotalCents),
    privateUnitPrice(line) ?? 'Onbekend',
  ]
  for (const item of route.lines) {
    const a = p.get(item.id)
    const b = d.get(item.id)
    const chosen = item.store === 'PLUS' ? a : b
    if (!a || !b || !chosen || seen.has(item.id) ||
        item.id !== chosen.id || item.productId !== chosen.productId ||
        item.productName !== chosen.productName ||
        item.packs !== chosen.packs ||
        item.lineTotalCents !== chosen.lineTotalCents ||
        item.packAmount !== chosen.pack.amount ||
        item.packCount !== chosen.pack.count ||
        item.packUnit !== chosen.pack.unit ||
        item.pricePerPackCents !== chosen.pricePerPackCents ||
        item.amount !== chosen.requirement.amount ||
        item.unit !== chosen.requirement.unit ||
        (item.store !== 'PLUS' && item.store !== 'DekaMarkt')) {
      throw Error('Een winkelkeuze past niet meer bij zijn oorspronkelijke, volledige mandje.')
    }
    seen.add(item.id)
    perStore[item.store] += chosen.lineTotalCents
    const delta = b.lineTotalCents - a.lineTotalCents
    rows.push([
      'ingredient', item.id, item.ingredientLabel,
      String(item.amount), item.unit, item.store,
      chosen.productId, chosen.productName, String(chosen.packs),
      String(chosen.pricePerPackCents), String(chosen.lineTotalCents),
      ...plain(a, captured.PLUS), ...plain(b, captured.DekaMarkt),
      String(delta), checked.has(item.key) ? 'ja' : 'nee',
      'Eigen gecontroleerde bron; geen openbare prijsclaim',
    ])
  }
  if (seen.size !== comparison.lineDeltas.length ||
      perStore.PLUS !== route.totals.PLUS ||
      perStore.DekaMarkt !== route.totals.DekaMarkt ||
      perStore.PLUS + perStore.DekaMarkt !== route.totalCents ||
      !Number.isSafeInteger(route.totalCents))
    throw Error('De gekozen route en de originele winkels hebben andere rekenkundige totalen.')
  const summary = Array<string>(columns.length).fill('')
  summary[0] = 'gekozen_mand_totaal'
  summary[10] = String(route.totalCents)
  summary[11] = captured.PLUS
  summary[16] = String(plus.totalCents)
  summary[18] = captured.DekaMarkt
  summary[23] = String(deka.totalCents)
  summary[27] = 'Alleen eigen opname. Reiskosten, bronrechten en zelfstandig veldbewijs niet inbegrepen.'
  rows.push(summary)
  if (rows.some(row => row.length !== columns.length)) throw Error('Ongeldige lokale winkelroute.')
  const csv = rows.map(row => row.map((value, index) =>
    literalCsv(value, index === 25)).join(',')).join('\r\n') + '\r\n'
  if (new TextEncoder().encode(csv).byteLength > 256_000)
    throw Error('De gekozen winkelroute is te groot voor een privé CSV.')
  return csv
}
