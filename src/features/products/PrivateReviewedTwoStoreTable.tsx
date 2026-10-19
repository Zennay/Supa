import type { BasketTraceLine } from '../../domain/basket.ts'
import { compareFullBaskets } from '../../domain/basketComparison.ts'
import { privatePackUnitRate, privateUnitPrice } from '../comparison/privateUnitPrice.ts'
import { currentPrivateRouteChoice } from '../comparison/privateRouteChoice.ts'
import { createMixedStoreShoppingPlan } from '../comparison/mixedStoreShoppingPlan.ts'
import { validCustomWeekBudgetEuros } from '../planner/customWeekBudget.ts'
import { privatePhysicalShoppingTick } from '../shopping-list/privatePhysicalShoppingTick.ts'
import { freshReviewedBaskets, privateReviewedPairWithin24Hours, type PrivateReviewedBaskets, type PrivateRouteChoice } from '../comparison/privateReviewedBasketBridge.ts'

type Matched = Extract<BasketTraceLine, { status: 'matched' }>
type OwnStore = 'PLUS' | 'DekaMarkt'
const money = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

/** Both sides are the exact SAME human-reviewed physical weekly demand.
 * No independent source authorization, live pricing or retail claim is implied.
 */
export function PrivateReviewedTwoStoreTable({ reviewed, search, unitFilter, order, budget, onOpenComparison, onOpenList, onOpenMixedRoute, onChooseRouteLine, checked }: {
  reviewed: PrivateReviewedBaskets
  search: string
  unitFilter: 'all' | 'kg' | 'liter' | 'stuk'
  order: 'source' | 'unitPrice' | 'lineTotal'
  budget: number
  onOpenComparison: () => void
  onOpenList: (store: OwnStore) => void
  onOpenMixedRoute: () => void
  onChooseRouteLine: (choice: Omit<PrivateRouteChoice, 'serial'>) => void
  checked: Readonly<Record<string, boolean>>
}) {
  const exactBudget = validCustomWeekBudgetEuros(budget)
  const budgetCents = exactBudget === null ? null : Math.round(exactBudget * 100)
  const budgetComparison = (totalCents: number) => budgetCents === null ? null :
    totalCents > budgetCents
      ? money.format((totalCents - budgetCents) / 100) + ' boven je Planner-weekbudget'
      : money.format((budgetCents - totalCents) / 100) + ' binnen je Planner-weekbudget'
  const fresh = freshReviewedBaskets(reviewed, reviewed.planKey, Date.now())
  const plus = fresh?.stores.PLUS
  const deka = fresh?.stores.DekaMarkt
  const comparable = !!plus && !!deka &&
    privateReviewedPairWithin24Hours(plus, deka) &&
    compareFullBaskets({ baseline: plus.basket, candidate: deka.basket }).claimable
  if (!comparable || !plus || !deka) {
    const missing = (['PLUS', 'DekaMarkt'] as const).filter(store => !fresh?.stores[store])
    const gap = !!plus && !!deka && !privateReviewedPairWithin24Hours(plus, deka)
    return <section className="private-reviewed-products__paired" aria-label="Winkelvergelijking van eigen artikelen">
      <h3>Vergelijk PLUS met DekaMarkt</h3>
      <div className="private-reviewed-products__source-coverage">
        {(['PLUS', 'DekaMarkt'] as const).map(shop => {
          const capture = fresh?.stores[shop]
          return <article key={shop}>
            <h4>{shop}</h4>
            {capture ? <>
              <strong>{money.format(capture.basket.totalCents / 100)}</strong>
              {budgetComparison(capture.basket.totalCents) && <small>
                {budgetComparison(capture.basket.totalCents)}</small>}
              <small>{capture.basket.lines.length} oorspronkelijke, gecontroleerde SKU-regels</small>
              <time dateTime={capture.observedAt}>{capture.observedAt}</time>
              <button type="button" onClick={() => onOpenList(shop)}>
                Bekijk mijn {shop}-boodschappenlijst
              </button>
            </> : <>
              <strong>Prijs onbekend</strong>
              <small>Geen volledige, actuele en door jou gecontroleerde eigen opname.</small>
            </>}
          </article>
        })}
      </div>
      <p role="status">{gap
        ? 'Beide eigen winkelmandjes bestaan, maar de waarnemingen liggen meer dan 24 uur uiteen. Herzie de oudere opname; er is nog geen geldig prijsverschil.'
        : missing.length > 0
          ? missing.join(' en ') + ' heeft nog geen volledig bruikbare eigen prijsopname. Vul de brongegevens aan voordat Supa een prijsverschil toont.'
          : 'Het bestaande bronpaar is nog niet betrouwbaar vergelijkbaar voor hetzelfde fysieke weekmandje. Controleer de productkoppelingen opnieuw.'}</p>
      <button type="button" onClick={onOpenComparison}>Open bronimport en productmatching</button>
      <small>Geen kassagarantie of onafhankelijk bewezen besparing. Een onbekende prijs is niet nul.</small>
    </section>
  }
  const dekaById = new Map(deka.basket.lines.filter((line): line is Matched =>
    line.status === 'matched').map(line => [line.id, line]))
  const rate = (line: Matched) => privatePackUnitRate({
    amount: line.pack.amount, unit: line.pack.unit,
    count: line.pack.count, priceCents: line.pricePerPackCents,
  })
  const family = (first: Matched, second: Matched) => {
    const a = rate(first)?.unit
    const b = rate(second)?.unit
    // €/kg cannot be sorted against €/liter even when totals use
    // the same physical ingredient demand. Keep conflicting packs ungrouped.
    return a && a === b ? a : null
  }
  const rows = plus.basket.lines.flatMap(line => {
    const alternate = dekaById.get(line.id)
    if (line.status !== 'matched' || !alternate) return []
    if (unitFilter !== 'all' && family(line, alternate) !== unitFilter) return []
    if (search && ![line.ingredientLabel, line.productId, line.productName,
      alternate.productId, alternate.productName].some(value =>
        value.toLocaleLowerCase('nl').includes(search))) return []
    return [{ plus: line, deka: alternate }]
  })
  if (order !== 'source') rows.sort((a, b) => {
    if (order === 'lineTotal') return (
      Math.min(a.plus.lineTotalCents, a.deka.lineTotalCents) -
      Math.min(b.plus.lineTotalCents, b.deka.lineTotalCents)
    )
    const unitOrder: Record<string, number> = { kg: 0, liter: 1, stuk: 2 }
    const groupA = family(a.plus, a.deka)
    const groupB = family(b.plus, b.deka)
    const groupDelta = (groupA ? unitOrder[groupA] : 3) -
      (groupB ? unitOrder[groupB] : 3)
    if (groupDelta) return groupDelta
    if (!groupA || !groupB) return 0
    return Math.min(rate(a.plus)!.centsPerUnit, rate(a.deka)!.centsPerUnit) -
      Math.min(rate(b.plus)!.centsPerUnit, rate(b.deka)!.centsPerUnit)
  })
  const mix = createMixedStoreShoppingPlan(plus.basket, deka.basket)
  const splitTrip = !!mix && mix.lines.some(line => line.store === 'PLUS') &&
    mix.lines.some(line => line.store === 'DekaMarkt')
  const wholeCheapestCents = Math.min(plus.basket.totalCents, deka.basket.totalCents)
  const delta = deka.basket.totalCents - plus.basket.totalCents
  const cheapest: OwnStore = delta >= 0 ? 'PLUS' : 'DekaMarkt'
  const leader = delta === 0 ? 'Beide mandjes zijn even duur.'
    : (delta > 0 ? 'PLUS' : 'DekaMarkt') + ' is ' +
      money.format(Math.abs(delta) / 100) + ' goedkoper voor alle hele verpakkingen.'
  const chooseIngredientStore = (ingredientId: string, store: OwnStore) => {
    const intent = currentPrivateRouteChoice(reviewed, ingredientId, store, Date.now())
    if (!intent) { onOpenComparison(); return }
    onChooseRouteLine(intent)
  }
  const product = (line: Matched, store: OwnStore) => <div className="private-reviewed-products__paired-option">
    <strong>{store}</strong>
    <span>{line.productName}</span>
    <small>Originele SKU {line.productId}</small>
    <small>{checked[privatePhysicalShoppingTick(reviewed.planKey, store,
      (store === 'PLUS' ? plus.basket : deka.basket).store.id, line)]
      ? '✓ Afgevinkt in eigen ' + store + '-lijst' : 'Nog niet afgevinkt in eigen ' + store + '-lijst'}</small>
    <span>{line.packs} × {line.pack.count} × {line.pack.amount} {line.pack.unit}</span>
    <small>{money.format(line.pricePerPackCents / 100)} per pak · {privateUnitPrice(line) ?? 'eenheidsprijs onbekend'}</small>
    <strong>{money.format(line.lineTotalCents / 100)} voor deze week</strong>
  </div>
  return <section className="private-reviewed-products__paired" aria-label="Mijn exacte twee-winkelprijsvergelijking">
    <h3>Zelfde weekmandje · twee winkels</h3>
    <p>PLUS: {money.format(plus.basket.totalCents / 100)} · DekaMarkt: {' '}
      {money.format(deka.basket.totalCents / 100)}</p>
    {budgetCents !== null && <div className="private-reviewed-products__budget-pair"
      aria-label="Mijn volledige weekmandjes vergeleken met mijn Planner-weekbudget">
      <p><strong>PLUS</strong> · {budgetComparison(plus.basket.totalCents)}</p>
      <p><strong>DekaMarkt</strong> · {budgetComparison(deka.basket.totalCents)}</p>
      <small>Alleen volledige door jou gecontroleerde mandjes, niet je zoekfilter
        of een berekening van werkelijk afgerekende producten.</small>
    </div>}
    <strong role="status">{leader}</strong>
    {mix && <div className="private-reviewed-products__route-preview">
      <h4>Goedkoopste originele artikelen combineren</h4>
      <p>Productkosten met hele verpakkingen: <strong>{money.format(mix.totalCents / 100)}</strong></p>
      <p>Voordeel t.o.v. goedkoopste volledige winkel, uitsluitend producten: {' '}
        <strong>{money.format(wholeCheapestCents - mix.totalCents >= 0
          ? (wholeCheapestCents - mix.totalCents) / 100 : 0)}</strong></p>
      <small>{splitTrip
        ? 'Twee winkels nodig. Extra reis-, parkeer- en tijdkosten zijn onbekend totdat je ze zelf invult. Netto voordeel wordt hier niet geclaimd.'
        : 'Voor deze goedkoopste productroute is slechts één winkel nodig; er is geen tweede winkelstop.'}</small>
      <button type="button" onClick={onOpenMixedRoute}>
        Open mijn gecombineerde route en eigen extra bezoekkosten
      </button>
    </div>}
    <small>Jouw gecontroleerde PLUS-bron: {plus.observedAt}. DekaMarkt-bron: {deka.observedAt}.
      Geen kassagarantie of onafhankelijk bewezen besparing; oorspronkelijke producten en
      prijzen kunnen veranderen.</small>
    <p role="status">{rows.length} van {plus.basket.lines.length} vergelijkbare ingrediënten
      bij je zoek-, eenheids- en sorteerselectie. Alle mandtotalen hierboven blijven
      gebaseerd op het volledige weekmenu, niet alleen de gefilterde producten.</p>
    <div className="private-reviewed-products__paired-rows">
      {rows.map(({ plus: first, deka: second }) => <article key={first.id}>
        <h4>{first.ingredientLabel} · {first.requirement.amount} {first.requirement.unit}</h4>
        <div className="private-reviewed-products__paired-options">
          {product(first, 'PLUS')}{product(second, 'DekaMarkt')}
        </div>
        <p>{first.lineTotalCents === second.lineTotalCents
          ? 'Zelfde regelbedrag voor jouw hoeveelheid.'
          : (first.lineTotalCents < second.lineTotalCents ? 'PLUS' : 'DekaMarkt') + ' is ' +
            money.format(Math.abs(first.lineTotalCents - second.lineTotalCents) / 100) +
            ' voordeliger voor dit ingrediënt.'}</p>
        <div className="private-reviewed-products__ingredient-route-actions"
          aria-label={'Kies winkel voor ' + first.ingredientLabel}>
          <button type="button" onClick={() => chooseIngredientStore(first.id, 'PLUS')}>
            Kies PLUS voor dit ingrediënt in mijn route
          </button>
          <button type="button" onClick={() => chooseIngredientStore(first.id, 'DekaMarkt')}>
            Kies DekaMarkt voor dit ingrediënt in mijn route
          </button>
        </div>
      </article>)}
      {!rows.length && <p>Geen vergelijkbare artikelen passen bij je zoekopdracht of eenheidsfilter.</p>}
    </div>
    <button type="button" onClick={() => onOpenList(cheapest)}>Open het goedkoopste volledige winkelmandje ({cheapest}) in Lijst</button>
  </section>
}
