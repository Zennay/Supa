import { useRef, useState } from 'react'
import { ownStoreWeekComparison } from '../planner/ownStoreBudgetComparison.ts'
import { printableOwnStoreComparison } from '../planner/downloadOwnStoreComparison.ts'
import { privateSingleStoreShoppingText } from '../shopping-list/privateSingleStoreShoppingText.ts'
import { PrivateManualShareText } from './PrivateManualShareText.tsx'
import { observedInstant } from '../../domain/offlineReviewedImport.ts'
import type { BasketTraceLine, OneStoreBasket } from '../../domain/basket.ts'
import { compareFullBaskets } from '../../domain/basketComparison.ts'
import { privatePackUnitRate, privateUnitPrice } from '../comparison/privateUnitPrice.ts'
import { productSearchText } from './productSearchText.ts'
import { currentPrivateRouteChoice } from '../comparison/privateRouteChoice.ts'
import { createMixedStoreShoppingPlan } from '../comparison/mixedStoreShoppingPlan.ts'
import { validCustomWeekBudgetEuros } from '../planner/customWeekBudget.ts'
import { parsePrivateExtraVisitCostCents } from '../comparison/privateExtraVisitCost.ts'
import { euro as exactEuro } from '../../lib/money.ts'
import { privatePhysicalShoppingTick } from '../shopping-list/privatePhysicalShoppingTick.ts'
import { freshReviewedBaskets, privateReviewedPairWithin24Hours, type PrivateReviewedBasket, type PrivateReviewedBaskets, type PrivateRouteChoice } from '../comparison/privateReviewedBasketBridge.ts'

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
  const reviewedRef = useRef(reviewed)
  reviewedRef.current = reviewed
  const [receiptMessage, setReceiptMessage] = useState('')
  const [manualCopy, setManualCopy] = useState<{
    text: string
    label: string
    planKey: string
    plus: PrivateReviewedBasket | null
    deka: PrivateReviewedBasket | null
  } | null>(null)
  const [shopAdvantage, setShopAdvantage] = useState<'all' | 'plus' | 'deka' | 'equal'>('all')
  // A personal travel-cost scenario is bound to the exact ORIGINAL source
  // objects, never inherited by a reimported price or another Planner week.
  const [visitScenario, setVisitScenario] = useState<{
    planKey: string
    plus: PrivateReviewedBasket
    deka: PrivateReviewedBasket
    raw: string
  } | null>(null)
  async function downloadSingle(shop: OwnStore, kind: 'csv' | 'txt' | 'html' | 'open-txt') {
    const origin = freshReviewedBaskets(reviewedRef.current, reviewedRef.current.planKey, Date.now())
    const receipt = origin?.stores[shop]
    if (!receipt || !origin) {
      setReceiptMessage('Geen geldige eigen ' + shop + '-bron om te bewaren.')
      return
    }
    try {
      const done = new Set(receipt.basket.lines.filter(line => line.status === 'matched' &&
        checked[privatePhysicalShoppingTick(origin.planKey, shop, receipt.basket.store.id, line)])
        .map(line => line.id))
      const content = kind === 'csv'
        ? (await import('../shopping-list/privateSourceShoppingCsv.ts'))
          .privateSingleStoreShoppingCsv({
            basket: receipt.basket, observedAt: receipt.observedAt,
            done,
          })
         : kind === 'txt' || kind === 'open-txt'
          ? privateSingleStoreShoppingText({
              basket: receipt.basket, observedAt: receipt.observedAt, done,
              onlyOpen: kind === 'open-txt',
            })
          : (await import('./privateOneStorePrintableHtml.ts'))
            .privateOneStorePrintableHtml({
              basket: receipt.basket, observedAt: receipt.observedAt,
              planKey: origin.planKey, checked,
              budgetCents: validCustomWeekBudgetEuros(budget) === null ? null :
                Math.round(Number(validCustomWeekBudgetEuros(budget)) * 100),
            })
      const latest = freshReviewedBaskets(reviewedRef.current,
        reviewedRef.current.planKey, Date.now())
      if (latest?.planKey !== origin.planKey || latest?.stores[shop] !== receipt)
        throw Error('De bron is tijdens voorbereiden veranderd.')
      const url = URL.createObjectURL(new Blob([content], {
        type: kind === 'csv' ? 'text/csv;charset=utf-8' : kind === 'html' ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8',
      }))
      try {
        const a = document.createElement('a')
        a.href = url
        a.download = 'supa-eigen-' + shop.toLowerCase() +
          (kind === 'open-txt' ? '-nog-te-kopen.txt' : '-weekmand.' + kind)
        document.body.append(a)
        try { a.click() } finally { a.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      const paired = !!latest?.stores.PLUS && !!latest.stores.DekaMarkt &&
        privateReviewedPairWithin24Hours(latest.stores.PLUS, latest.stores.DekaMarkt) &&
        ownStoreWeekComparison(latest).status === 'comparable'
      setReceiptMessage(shop + (kind === 'open-txt'
        ? ': alleen open artikelen bewaard. '
        : ': eigen volledig weekmandje bewaard. ') +
        (paired ? 'Ook de tweede winkel heeft een afzonderlijke, complete bron.' :
          'Een compleet prijsverschil met de andere winkel is nog niet beschikbaar.'))
    } catch {
      setReceiptMessage('Download van eigen ' + shop + '-mand mislukt. Herzie de bron.')
    }
  }
  function prepareSingleText(shop: OwnStore, onlyOpen: boolean) {
    const current = freshReviewedBaskets(reviewedRef.current,
      reviewedRef.current.planKey, Date.now())
    const source = current?.stores[shop]
    if (!current || !source) {
      setReceiptMessage(shop + ': geen geldige actuele eigen bron om te tonen.')
      return
    }
    try {
      const done = new Set(source.basket.lines.filter(line => line.status === 'matched' &&
        checked[privatePhysicalShoppingTick(current.planKey, shop, source.basket.store.id, line)])
        .map(line => line.id))
      const text = privateSingleStoreShoppingText({
        basket: source.basket, observedAt: source.observedAt, done, onlyOpen,
      })
      const latest = freshReviewedBaskets(reviewedRef.current,
        reviewedRef.current.planKey, Date.now())
      if (latest?.stores[shop] !== source || latest.planKey !== current.planKey)
        throw Error('Eigen winkelbron is veranderd.')
      setManualCopy({
        text, label: shop + (onlyOpen ? ' · alleen nog te kopen' : ' · volledige privéweekmand'),
        planKey: current.planKey, plus: current.stores.PLUS ?? null,
        deka: current.stores.DekaMarkt ?? null,
      })
      setReceiptMessage('Selecteer de persoonlijke tekst hieronder om zelf te kopiëren of te delen.')
    } catch {
      setManualCopy(null)
      setReceiptMessage(shop + ': privétekst niet beschikbaar. Bewaar de lokale TXT-download.')
    }
  }
  async function downloadReceipt(kind: 'csv' | 'txt' | 'html') {
    // Keep the display and export on the same admitted original physical
    // demand. Await lazy receipt code before rechecking source expiry.
    const initial = freshReviewedBaskets(reviewedRef.current,
      reviewedRef.current.planKey, Date.now())
    try {
      const exports = await import('../planner/downloadOwnStoreComparison.ts')
      const print = kind === 'html' ? await import('./privateTwoStorePrintableHtml.ts') : null
      const current = freshReviewedBaskets(reviewedRef.current,
        reviewedRef.current.planKey, Date.now())
      if (!current || !initial || current.planKey !== initial.planKey ||
          current.stores.PLUS !== initial.stores.PLUS ||
          current.stores.DekaMarkt !== initial.stores.DekaMarkt) {
        setReceiptMessage('Bronnen gewijzigd tijdens voorbereiden. Start opnieuw.')
        return
      }
      const comparison = ownStoreWeekComparison(current)
      if (!current?.stores.PLUS || !current.stores.DekaMarkt ||
          !privateReviewedPairWithin24Hours(current.stores.PLUS, current.stores.DekaMarkt) ||
          comparison.status !== 'comparable') {
        setReceiptMessage('De originele winkelopnames zijn niet meer samen vergelijkbaar. Controleer ze opnieuw in Vergelijk.')
        return
      }
      if (kind === 'csv') {
        exports.downloadOwnStoreCsv(current, comparison)
      } else if (kind === 'txt') {
        const text = exports.printableOwnStoreComparison(comparison, {
          PLUS: current.stores.PLUS.observedAt,
          DekaMarkt: current.stores.DekaMarkt.observedAt,
        }, null, {
          planKey: current.planKey,
          stores: {
            PLUS: current.stores.PLUS.basket.store.id,
            DekaMarkt: current.stores.DekaMarkt.basket.store.id,
          },
          checked,
        })
        exports.downloadOwnStoreText(text)
      } else {
        if (!print) throw Error('Printweergave niet beschikbaar.')
        const html = print.privateTwoStorePrintableHtml(comparison, {
          PLUS: current.stores.PLUS.observedAt,
          DekaMarkt: current.stores.DekaMarkt.observedAt,
        }, {
          planKey: current.planKey,
          storeIds: {
            PLUS: current.stores.PLUS.basket.store.id,
            DekaMarkt: current.stores.DekaMarkt.basket.store.id,
          },
          checked,
        }, validCustomWeekBudgetEuros(budget) === null ? null :
          Math.round(Number(validCustomWeekBudgetEuros(budget)) * 100))
        // The paired sources must still be current after formatting.
        const final = freshReviewedBaskets(reviewedRef.current,
          reviewedRef.current.planKey, Date.now())
        if (!final || final.planKey !== current.planKey ||
            final.stores.PLUS !== current.stores.PLUS ||
            final.stores.DekaMarkt !== current.stores.DekaMarkt) {
          throw Error('De bron is tijdens het afdrukken veranderd.')
        }
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
        try {
          const link = document.createElement('a')
          link.href = url
          link.download = 'supa-prive-plus-deka-weekvergelijking.html'
          document.body.append(link)
          try { link.click() } finally { link.remove() }
        } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      }
      setReceiptMessage('Privé-overzicht gemaakt uit de twee volledige, actuele eigen winkelmandjes.')
    } catch {
      setReceiptMessage('Het privé-overzicht kon niet worden gemaakt. Je winkelbronnen blijven ongewijzigd.')
    }
  }
  function preparePairedText() {
    const current = freshReviewedBaskets(reviewedRef.current,
      reviewedRef.current.planKey, Date.now())
    const comparison = ownStoreWeekComparison(current)
    if (!current?.stores.PLUS || !current.stores.DekaMarkt ||
        !privateReviewedPairWithin24Hours(current.stores.PLUS, current.stores.DekaMarkt) ||
        comparison.status !== 'comparable') {
      setManualCopy(null)
      setReceiptMessage('De originele winkelbronnen zijn niet meer compleet vergelijkbaar.')
      return
    }
    try {
      const text = printableOwnStoreComparison(comparison, {
        PLUS: current.stores.PLUS.observedAt,
        DekaMarkt: current.stores.DekaMarkt.observedAt,
      }, null, {
        planKey: current.planKey,
        stores: {
          PLUS: current.stores.PLUS.basket.store.id,
          DekaMarkt: current.stores.DekaMarkt.basket.store.id,
        },
        checked,
      })
      const latest = freshReviewedBaskets(reviewedRef.current,
        reviewedRef.current.planKey, Date.now())
      if (latest?.stores.PLUS !== current.stores.PLUS ||
          latest.stores.DekaMarkt !== current.stores.DekaMarkt ||
          latest.planKey !== current.planKey) throw Error('De bronnen zijn veranderd.')
      setManualCopy({
        text, label: 'PLUS / DekaMarkt · volledig eigen weekmandje',
        planKey: current.planKey, plus: current.stores.PLUS,
        deka: current.stores.DekaMarkt,
      })
      setReceiptMessage('Selecteer de volledige persoonlijke vergelijking hieronder om zelf te kopiëren.')
    } catch {
      setManualCopy(null)
      setReceiptMessage('De privévergelijking kon niet als selecteerbare tekst worden gemaakt.')
    }
  }
  const exactBudget = validCustomWeekBudgetEuros(budget)
  const budgetCents = exactBudget === null ? null : Math.round(exactBudget * 100)
  const budgetComparison = (totalCents: number) => budgetCents === null ? null :
    totalCents > budgetCents
      ? money.format((totalCents - budgetCents) / 100) + ' boven je Planner-weekbudget'
      : money.format((budgetCents - totalCents) / 100) + ' binnen je Planner-weekbudget'
  const fresh = freshReviewedBaskets(reviewed, reviewed.planKey, Date.now())
  const manualCopyVisible = manualCopy?.planKey === reviewed.planKey &&
    manualCopy.plus === (fresh?.stores.PLUS ?? null) &&
    manualCopy.deka === (fresh?.stores.DekaMarkt ?? null) ? manualCopy : null
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
  function shopProgress(shop: OwnStore, basket: OneStoreBasket) {
    const lines = basket.lines.filter(line => line.status === 'matched')
    const done = lines.filter(line => checked[privatePhysicalShoppingTick(
      reviewed.planKey, shop, basket.store.id, line)]).length
    const remainingCents = lines.reduce((total, line) =>
      checked[privatePhysicalShoppingTick(reviewed.planKey, shop, basket.store.id, line)]
        ? total : total + line.lineTotalCents, 0)
    return <div className="private-reviewed-products__shop-progress">
      <label>{done} van {lines.length} oorspronkelijke artikelen afgevinkt
        <progress value={done} max={Math.max(1, lines.length)} />
      </label>
      <strong>Nog op jouw lijst: {money.format(remainingCents / 100)}</strong>
      <small>Dit zijn oorspronkelijke hele-pakprijzen van open artikelen,
        geen betaalde kassasom of actuele winkelprijs.</small>
    </div>
  }
  // Both a one-sided source and a fully paired comparison need an actionable
  // standalone shop trip. Never make the shopper undo a second-store import.
  function singleStoreTripActions(shop: OwnStore) {
    return <div className="private-reviewed-products__single-trip-actions">
              <button type="button" onClick={() => openCheckedStoreList(shop)}>
                Bekijk mijn {shop}-boodschappenlijst
              </button>
              <button type="button" onClick={() => { void downloadSingle(shop, 'csv') }}>
                Bewaar mijn {shop}-weekmand (CSV)
              </button>
              <button type="button" onClick={() => { void downloadSingle(shop, 'txt') }}>
                Bewaar mijn {shop}-lijst (TXT)
              </button>
              <button type="button" onClick={() => { void downloadSingle(shop, 'open-txt') }}>
                Bewaar alleen nog te kopen bij {shop} (TXT)
              </button>
              <button type="button" onClick={() => { void downloadSingle(shop, 'html') }}>
                Print mijn {shop}-weekmand (HTML)
              </button>
              <button type="button" onClick={() => prepareSingleText(shop, false)}>
                Toon mijn {shop}-lijst om zelf te kopiëren of delen
              </button>
              <button type="button" onClick={() => prepareSingleText(shop, true)}>
                Toon alleen nog te kopen bij {shop} om te kopiëren
              </button>
    </div>
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
              {shopProgress(shop, capture.basket)}
              {singleStoreTripActions(shop)}
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
      {receiptMessage && <p role="status">{receiptMessage}</p>}
      {manualCopyVisible && <PrivateManualShareText key={manualCopyVisible.text}
        text={manualCopyVisible.text} label={manualCopyVisible.label} />}
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
  const currentVisitCost = visitScenario?.planKey === reviewed.planKey &&
    visitScenario.plus === plus && visitScenario.deka === deka
    ? visitScenario.raw : ''
  const extraVisitCostCents = currentVisitCost.trim()
    ? parsePrivateExtraVisitCostCents(currentVisitCost) : null
  const extraVisitCostInvalid = currentVisitCost.trim() !== '' &&
    extraVisitCostCents === null
  const mixedWithVisitCents = splitTrip && mix && extraVisitCostCents !== null
    ? BigInt(mix.totalCents) + BigInt(extraVisitCostCents) : null

  const mixedNetCents = mixedWithVisitCents === null ? null
    : BigInt(Math.min(plus.basket.totalCents, deka.basket.totalCents)) -
      mixedWithVisitCents

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
    <details className="private-reviewed-products__single-shop-panel">
      <summary>Ik ga naar één winkel · aparte lijst en printbare bron</summary>
      <div className="private-reviewed-products__source-coverage">
        {(['PLUS', 'DekaMarkt'] as const).map(shop => {
          const source = shop === 'PLUS' ? plus : deka
          return <article key={shop}>
            <h4>{shop}</h4>
            <strong>{money.format(source.basket.totalCents / 100)}</strong>
            {shopProgress(shop, source.basket)}
            <time dateTime={source.observedAt}>Eigen bron: {source.observedAt}</time>
            {singleStoreTripActions(shop)}
          </article>
        })}
      </div>
      <small>De persoonlijke lijst per winkel bevat altijd het originele complete mandje
        en jouw afvinkingen; de andere winkel verandert niet door downloaden of delen.</small>
    </details>
    <div className="private-reviewed-products__receipt-actions">
      <button type="button" onClick={() => { void downloadReceipt('csv') }}>
        Download volledige PLUS/Deka-prijsvergelijking (CSV)
      </button>
      <button type="button" onClick={() => { void downloadReceipt('txt') }}>
        Bewaar leesbaar winkeloverzicht (TXT)
      </button>
      <button type="button" onClick={() => { void downloadReceipt('html') }}>
        Bewaar printbaar volledig weekmandje (HTML)
      </button>
      <button type="button" onClick={preparePairedText}>
        Toon complete privévergelijking om zelf te kopiëren of delen
      </button>
      <small>Downloads, kopiëren en expliciet delen gebruiken het originele complete weekmandje en
        bronmomenten, onafhankelijk van je zoekfilter. Alleen privé; geen kassagarantie,
        openbare besparingsclaim of nieuwe winkelbronimport.</small>
      {receiptMessage && <p role="status">{receiptMessage}</p>}
      {manualCopyVisible && <PrivateManualShareText key={manualCopyVisible.text}
        text={manualCopyVisible.text} label={manualCopyVisible.label} />}
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
        ? extraVisitCostCents === null
          ? 'Twee winkels nodig. Zonder jouw extra winkelstopkosten is het netto verschil onbekend.'
          : 'Twee winkels nodig. Jouw ingevoerde extra stopkosten zijn hieronder verwerkt; reistijd en overige kosten blijven onbekend.'
        : 'Voor deze goedkoopste productroute is slechts één winkel nodig; er is geen tweede winkelstop.'}</small>
      {splitTrip && <div className="private-reviewed-products__trip-cost">
        <label>Mijn extra kosten voor een tweede winkelstop (€)
          <input type="text" inputMode="decimal" maxLength={9}
            placeholder="Bijv. 2,50" value={currentVisitCost}
            onChange={event => setVisitScenario({
              planKey: reviewed.planKey, plus, deka, raw: event.currentTarget.value,
            })} />
        </label>
        {extraVisitCostInvalid && <p role="alert">Voer een bedrag tussen € 0,00
          en € 1.000,00 in met maximaal twee decimalen.</p>}
        {!extraVisitCostInvalid && mixedWithVisitCents === null &&
          <p>Netto verschil onbekend totdat je jouw extra winkelstopkosten invult.
            Reistijd en niet-opgegeven kosten zijn niet meegenomen.</p>}
        {mixedWithVisitCents !== null && mixedNetCents !== null && <>
          <p role="status">Twee winkelstops inclusief jouw opgegeven extra kosten:
            {' '}<strong>{exactEuro.formatCents(mixedWithVisitCents)}</strong>.
            {' '}{mixedNetCents > 0n
              ? exactEuro.formatCents(mixedNetCents) + ' goedkoper dan één volledige winkel.'
              : mixedNetCents === 0n
                ? 'Even duur als één volledige winkel.'
                : 'Eén volledige winkel is ' + exactEuro.formatCents(-mixedNetCents) +
                  ' goedkoper.'}</p>
          {budgetCents !== null && <p>Ten opzichte van jouw Planner-weekbudget:
            {' '}{mixedWithVisitCents > BigInt(budgetCents)
              ? exactEuro.formatCents(mixedWithVisitCents - BigInt(budgetCents)) +
                ' boven budget.'
              : exactEuro.formatCents(BigInt(budgetCents) - mixedWithVisitCents) +
                ' binnen budget.'}</p>}
          <small>Persoonlijke scenario-inschatting op basis van hele originele
            verpakkingen, zonder reistijd, extra aankopen of kassagarantie.
            Deze invoer wordt niet als bronprijs of bewijs opgeslagen.</small>
        </>}
      </div>}
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
