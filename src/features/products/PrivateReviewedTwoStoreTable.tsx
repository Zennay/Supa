import { useState } from 'react'
import { ownStoreWeekComparison } from '../planner/ownStoreBudgetComparison.ts'
import { observedInstant } from '../../domain/offlineReviewedImport.ts'
import type { BasketTraceLine } from '../../domain/basket.ts'
import { compareFullBaskets } from '../../domain/basketComparison.ts'
import { privatePackUnitRate, privateUnitPrice } from '../comparison/privateUnitPrice.ts'
import { productSearchText } from './productSearchText.ts'
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
  order: 'source' | 'unitPrice' | 'lineTotal' | 'priceGap'
  budget: number
  onOpenComparison: () => void
  onOpenList: (store: OwnStore) => void
  onOpenMixedRoute: () => void
  onChooseRouteLine: (choice: Omit<PrivateRouteChoice, 'serial'>) => void
  checked: Readonly<Record<string, boolean>>
}) {
  const [receiptMessage, setReceiptMessage] = useState('')
  const [shopAdvantage, setShopAdvantage] = useState<'all' | 'plus' | 'deka' | 'equal'>('all')
  async function downloadReceipt(kind: 'csv' | 'txt') {
    // Keep the display and export on the same admitted original physical
    // demand. Await lazy receipt code before rechecking source expiry.
    try {
      const exports = await import('../planner/downloadOwnStoreComparison.ts')
      const current = freshReviewedBaskets(reviewed, reviewed.planKey, Date.now())
      const comparison = ownStoreWeekComparison(current)
      if (!current?.stores.PLUS || !current.stores.DekaMarkt ||
          !privateReviewedPairWithin24Hours(current.stores.PLUS, current.stores.DekaMarkt) ||
          comparison.status !== 'comparable') {
        setReceiptMessage('De originele winkelopnames zijn niet meer samen vergelijkbaar. Controleer ze opnieuw in Vergelijk.')
        return
      }
      if (kind === 'csv') {
        exports.downloadOwnStoreCsv(current, comparison)
      } else {
        const text = exports.printableOwnStoreComparison(comparison, {
          PLUS: current.stores.PLUS.observedAt,
          DekaMarkt: current.stores.DekaMarkt.observedAt,
        })
        exports.downloadOwnStoreText(text)
      }
      setReceiptMessage('Privé-overzicht gemaakt uit de twee volledige, actuele eigen winkelmandjes.')
    } catch {
      setReceiptMessage('Het privé-overzicht kon niet worden gemaakt. Je winkelbronnen blijven ongewijzigd.')
    }
  }
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
  // A tab may cross its expiry boundary between renders. Navigation that
  // commits a store/route preference must read the real clock again.
  function openCheckedStoreList(shop: OwnStore) {
    const now = freshReviewedBaskets(reviewed, reviewed.planKey, Date.now())
    if (!now?.stores[shop]) { onOpenComparison(); return }
    onOpenList(shop)
  }
  function openCheckedMixedRoute() {
    const now = freshReviewedBaskets(reviewed, reviewed.planKey, Date.now())
    if (!now?.stores.PLUS || !now.stores.DekaMarkt ||
        !privateReviewedPairWithin24Hours(now.stores.PLUS, now.stores.DekaMarkt) ||
        !compareFullBaskets({
          baseline: now.stores.PLUS.basket,
          candidate: now.stores.DekaMarkt.basket,
        }).claimable) { onOpenComparison(); return }
    onOpenMixedRoute()
  }
  if (!comparable || !plus || !deka) {
    const missing = (['PLUS', 'DekaMarkt'] as const).filter(store => !fresh?.stores[store])
    const gap = !!plus && !!deka && !privateReviewedPairWithin24Hours(plus, deka)
    const plusMoment = plus ? observedInstant(plus.observedAt) : null
    const dekaMoment = deka ? observedInstant(deka.observedAt) : null
    const older: OwnStore | null = gap && plusMoment && dekaMoment
      ? (plusMoment.ns < dekaMoment.ns ? 'PLUS' : 'DekaMarkt') : null
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
              <button type="button" onClick={() => openCheckedStoreList(shop)}>
                Bekijk mijn {shop}-boodschappenlijst
              </button>
            </> : <>
              <strong>Prijs onbekend</strong>
              <small>{reviewed.stores[shop]
                ? 'Je eerdere eigen opname is verlopen of niet meer bruikbaar. Herzie deze bron.'
                : 'Nog geen volledige, actuele en persoonlijk gecontroleerde eigen opname.'}</small>
            </>}
          </article>
        })}
      </div>
      <p role="status">{gap
        ? 'Je eigen PLUS- en DekaMarkt-opnames liggen meer dan 24 uur uiteen. Herzie ' +
          (older ?? 'de oudste winkelbron') + ' voor een controleerbaar bronpaar; een prijsverschil blijft onbekend.'
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
        productSearchText(value).includes(search))) return []
    return [{ plus: line, deka: alternate }]
  })
  const advantaged = rows.filter(({ plus: first, deka: second }) =>
    shopAdvantage === 'all' ||
    (shopAdvantage === 'plus' && first.lineTotalCents < second.lineTotalCents) ||
    (shopAdvantage === 'deka' && second.lineTotalCents < first.lineTotalCents) ||
    (shopAdvantage === 'equal' && first.lineTotalCents === second.lineTotalCents))
  if (order !== 'source') advantaged.sort((a, b) => {
    if (order === 'priceGap') return (
      Math.abs(b.plus.lineTotalCents - b.deka.lineTotalCents) -
      Math.abs(a.plus.lineTotalCents - a.deka.lineTotalCents)
    )
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
  // This is a navigation aid, not a savings claim. Only visible, paired,
  // wholly priced ingredient lines contribute to the difference overview.
  const changed = advantaged.filter(row => row.plus.lineTotalCents !== row.deka.lineTotalCents)
  const largest = changed.length ? [...changed].sort((a, b) =>
    Math.abs(b.plus.lineTotalCents - b.deka.lineTotalCents) -
    Math.abs(a.plus.lineTotalCents - a.deka.lineTotalCents))[0] : null
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
  function unitPriceWarning(first: Matched, second: Matched): string | null {
    const a = rate(first)
    const b = rate(second)
    if (!a || !b || a.unit !== b.unit ||
        a.centsPerUnit === b.centsPerUnit ||
        first.lineTotalCents === second.lineTotalCents) return null
    const cheaperUnit: OwnStore = a.centsPerUnit < b.centsPerUnit ? 'PLUS' : 'DekaMarkt'
    const cheaperWeek: OwnStore = first.lineTotalCents < second.lineTotalCents
      ? 'PLUS' : 'DekaMarkt'
    return cheaperUnit === cheaperWeek ? null
      : cheaperUnit + ' heeft de lagere indicatieve prijs per ' + a.unit +
        ', maar ' + cheaperWeek + ' kost minder aan HELE verpakkingen voor jouw weekvraag.'
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
    <div className="private-reviewed-products__receipt-actions">
      <button type="button" onClick={() => { void downloadReceipt('csv') }}>
        Download volledige PLUS/Deka-prijsvergelijking (CSV)
      </button>
      <button type="button" onClick={() => { void downloadReceipt('txt') }}>
        Bewaar leesbaar winkeloverzicht (TXT)
      </button>
      <small>Beide downloads bevatten het originele complete weekmandje en
        bronmomenten, onafhankelijk van je zoekfilter. Alleen privé; geen kassagarantie,
        openbare besparingsclaim of nieuwe winkelbronimport.</small>
      {receiptMessage && <p role="status">{receiptMessage}</p>}
    </div>
    <div className="private-reviewed-products__advantage-filter"
      role="group" aria-label="Filter persoonlijk gecontroleerde regelprijzen per winkel">
      {([
        ['all', 'Beide winkels'],
        ['plus', 'Alleen PLUS goedkoper'],
        ['deka', 'Alleen DekaMarkt goedkoper'],
        ['equal', 'Zelfde hele-pakprijs'],
      ] as const).map(([value, label]) => <button key={value} type="button"
        aria-pressed={shopAdvantage === value}
        onClick={() => setShopAdvantage(value)}>{label}</button>)}
    </div>
    <div className="private-reviewed-products__difference-focus" aria-label="Prijsverschil per ingrediënt">
      <strong>{changed.length} van {advantaged.length} geselecteerde ingrediënten verschillen in hele-pakprijs.</strong>
      {largest ? <p>Grootste zichtbaar verschil: <strong>{largest.plus.ingredientLabel}</strong> · {' '}
        {money.format(Math.abs(largest.plus.lineTotalCents - largest.deka.lineTotalCents) / 100)} goedkoper bij {' '}
        {largest.plus.lineTotalCents < largest.deka.lineTotalCents ? 'PLUS' : 'DekaMarkt'}.
      </p> : <p>Geen verschillende hele-pakprijzen in deze selectie.</p>}
      <small>Dit overzicht volgt de zoek- en eenheidsfilters; de mandtotalen en
        goedkoopste winkel hierboven blijven gebaseerd op alle originele weekartikelen.</small>
    </div>
    {mix && <div className="private-reviewed-products__route-preview">
      <h4>Goedkoopste originele artikelen combineren</h4>
      <p>Productkosten met hele verpakkingen: <strong>{money.format(mix.totalCents / 100)}</strong></p>
      <p>Voordeel t.o.v. goedkoopste volledige winkel, uitsluitend producten: {' '}
        <strong>{money.format(wholeCheapestCents - mix.totalCents >= 0
          ? (wholeCheapestCents - mix.totalCents) / 100 : 0)}</strong></p>
      <small>{splitTrip
        ? 'Twee winkels nodig. Extra reis-, parkeer- en tijdkosten zijn onbekend totdat je ze zelf invult. Netto voordeel wordt hier niet geclaimd.'
        : 'Voor deze goedkoopste productroute is slechts één winkel nodig; er is geen tweede winkelstop.'}</small>
      <button type="button" onClick={openCheckedMixedRoute}>
        Open mijn gecombineerde route en eigen extra bezoekkosten
      </button>
    </div>}
    <small>Jouw gecontroleerde PLUS-bron: {plus.observedAt}. DekaMarkt-bron: {deka.observedAt}.
      Geen kassagarantie of onafhankelijk bewezen besparing; oorspronkelijke producten en
      prijzen kunnen veranderen.</small>
    <p role="status">{advantaged.length} van {plus.basket.lines.length} vergelijkbare ingrediënten
      bij je zoek-, eenheids- en sorteerselectie. Alle mandtotalen hierboven blijven
      gebaseerd op het volledige weekmenu, niet alleen de gefilterde producten.</p>
    <div className="private-reviewed-products__paired-rows">
      {advantaged.map(({ plus: first, deka: second }) => <article key={first.id}>
        <h4>{first.ingredientLabel} · {first.requirement.amount} {first.requirement.unit}</h4>
        <div className="private-reviewed-products__paired-options">
          {product(first, 'PLUS')}{product(second, 'DekaMarkt')}
        </div>
        <p>{first.lineTotalCents === second.lineTotalCents
          ? 'Zelfde regelbedrag voor jouw hoeveelheid.'
          : (first.lineTotalCents < second.lineTotalCents ? 'PLUS' : 'DekaMarkt') + ' is ' +
            money.format(Math.abs(first.lineTotalCents - second.lineTotalCents) / 100) +
            ' voordeliger voor dit ingrediënt.'}</p>
        {unitPriceWarning(first, second) && <p className="private-reviewed-products__unit-caveat">
          {unitPriceWarning(first, second)}
          {' '}Supa rekent het winkelmandje met de werkelijk benodigde hele pakken,
          nooit alleen met de indicatieve eenheidsprijs.
        </p>}
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
      {!advantaged.length && <p>Geen vergelijkbare artikelen passen bij je zoek-, eenheids- of winkelvoordeelfilter.</p>}
    </div>
    <button type="button" onClick={() => openCheckedStoreList(cheapest)}>Open het goedkoopste volledige winkelmandje ({cheapest}) in Lijst</button>
  </section>
}
