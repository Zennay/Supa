import { useRef, useState } from 'react'
import { ownStoreWeekComparison } from '../planner/ownStoreBudgetComparison.ts'
import { printableOwnStoreComparison } from '../planner/downloadOwnStoreComparison.ts'
import { privateSingleStoreShoppingText } from '../shopping-list/privateSingleStoreShoppingText.ts'
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
  const reviewedRef = useRef(reviewed)
  reviewedRef.current = reviewed
  const [receiptMessage, setReceiptMessage] = useState('')
  const [shopAdvantage, setShopAdvantage] = useState<'all' | 'plus' | 'deka' | 'equal'>('all')
  async function downloadSingle(shop: OwnStore, kind: 'csv' | 'txt') {
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
        : privateSingleStoreShoppingText({ basket: receipt.basket, observedAt: receipt.observedAt, done })
      const latest = freshReviewedBaskets(reviewedRef.current,
        reviewedRef.current.planKey, Date.now())
      if (latest?.planKey !== origin.planKey || latest?.stores[shop] !== receipt)
        throw Error('De bron is tijdens voorbereiden veranderd.')
      const url = URL.createObjectURL(new Blob([content], {
        type: kind === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8',
      }))
      try {
        const a = document.createElement('a')
        a.href = url
        a.download = 'supa-eigen-' + shop.toLowerCase() + '-weekmand.' + kind
        document.body.append(a)
        try { a.click() } finally { a.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      const paired = !!latest?.stores.PLUS && !!latest.stores.DekaMarkt &&
        privateReviewedPairWithin24Hours(latest.stores.PLUS, latest.stores.DekaMarkt) &&
        ownStoreWeekComparison(latest).status === 'comparable'
      setReceiptMessage(shop + ': eigen volledig weekmandje bewaard. ' +
        (paired ? 'Ook de tweede winkel heeft een afzonderlijke, complete bron.' :
          'Een compleet prijsverschil met de andere winkel is nog niet beschikbaar.'))
    } catch {
      setReceiptMessage('Download van eigen ' + shop + '-mand mislukt. Herzie de bron.')
    }
  }
  async function handoffSingle(shop: OwnStore, action: 'copy' | 'share') {
    const current = freshReviewedBaskets(reviewedRef.current,
      reviewedRef.current.planKey, Date.now())
    const source = current?.stores[shop]
    if (!current || !source) {
      setReceiptMessage(shop + ': geen geldige actuele eigen bron om mee te nemen.')
      return
    }
    try {
      const done = new Set(source.basket.lines.filter(line => line.status === 'matched' &&
        checked[privatePhysicalShoppingTick(current.planKey, shop, source.basket.store.id, line)])
        .map(line => line.id))
      // Synchronous serialization retains transient user activation for
      // clipboard/native share. No implicit upload or retailer fetch.
      const body = privateSingleStoreShoppingText({
        basket: source.basket, observedAt: source.observedAt, done,
      })
      const latest = freshReviewedBaskets(reviewedRef.current,
        reviewedRef.current.planKey, Date.now())
      if (latest?.stores[shop] !== source || latest.planKey !== current.planKey)
        throw Error('Eigen winkelbron is veranderd.')
      if (action === 'copy') {
        if (!navigator.clipboard?.writeText) {
          setReceiptMessage('Klembord niet beschikbaar. Download je eigen winkel-TXT.')
          return
        }
        await navigator.clipboard.writeText(body)
        setReceiptMessage(shop + ': eigen lijst inclusief afvinkingen gekopieerd.')
      } else {
        if (!navigator.share) {
          setReceiptMessage('Delen niet beschikbaar. Download je eigen winkel-TXT.')
          return
        }
        await navigator.share({ title: 'SUPA · mijn ' + shop + '-lijst', text: body })
        setReceiptMessage(shop + ': eigen lijst aangeboden aan het deelvenster.')
      }
    } catch (error) {
      if (action === 'share' && error instanceof Error && error.name === 'AbortError')
        setReceiptMessage('Delen geannuleerd; jouw gegevens blijven behouden.')
      else setReceiptMessage(shop + ': overdragen mislukt. Gebruik de lokale TXT-download.')
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
        })
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
  async function handoffReceipt(kind: 'copy' | 'share') {
    const initial = freshReviewedBaskets(reviewedRef.current,
      reviewedRef.current.planKey, Date.now())
    if (!initial?.stores.PLUS || !initial.stores.DekaMarkt ||
        !privateReviewedPairWithin24Hours(initial.stores.PLUS, initial.stores.DekaMarkt)) {
      setReceiptMessage('Een complete actuele vergelijking ontbreekt. Controleer eerst beide bronnen.')
      return
    }
    try {
      // Share APIs require a transient direct user gesture: never await a
      // dynamic import before invoking navigator.share or clipboard.
      const current = freshReviewedBaskets(reviewedRef.current,
        reviewedRef.current.planKey, Date.now())
      if (!current || current.planKey !== initial.planKey ||
          current.stores.PLUS !== initial.stores.PLUS ||
          current.stores.DekaMarkt !== initial.stores.DekaMarkt) {
        throw Error('Bronnen tijdens voorbereiding gewijzigd.')
      }
      const comparison = ownStoreWeekComparison(current)
      if (comparison.status !== 'comparable' ||
          !current.stores.PLUS || !current.stores.DekaMarkt) {
        throw Error('Geen vergelijkbare mandjes.')
      }
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
      if (kind === 'copy') {
        if (!navigator.clipboard?.writeText) {
          setReceiptMessage('Kopiëren wordt hier niet ondersteund. Gebruik de privé-TXT-download.')
          return
        }
        await navigator.clipboard.writeText(text)
        setReceiptMessage('Je volledige privéweekmand is naar je klembord gekopieerd.')
      } else {
        if (!navigator.share) {
          setReceiptMessage('Mobiel delen wordt hier niet ondersteund. Bewaar een TXT- of HTML-bestand.')
          return
        }
        // Native share sheet only after explicit user action. Never upload the
        // personal comparison or silently send it to a third party.
        await navigator.share({ title: 'SUPA · mijn privéweekmand', text })
        setReceiptMessage('Je privéweekmand is via het gekozen deelvenster aangeboden.')
      }
    } catch (error) {
      if (kind === 'share' && typeof error === 'object' && error !== null &&
          'name' in error && error.name === 'AbortError') {
        setReceiptMessage('Delen geannuleerd. Je winkelbronnen zijn behouden.')
      } else {
        setReceiptMessage('Privéoverzicht niet overgedragen. Controleer de bronnen of bewaar als TXT.')
      }
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
              <button type="button" onClick={() => { void downloadSingle(shop, 'csv') }}>
                Bewaar mijn {shop}-weekmand (CSV)
              </button>
              <button type="button" onClick={() => { void downloadSingle(shop, 'txt') }}>
                Bewaar mijn {shop}-lijst (TXT)
              </button>
              <button type="button" onClick={() => { void handoffSingle(shop, 'copy') }}>
                Kopieer mijn {shop}-lijst inclusief afvinkingen
              </button>
              <button type="button" onClick={() => { void handoffSingle(shop, 'share') }}>
                Deel mijn {shop}-lijst via apparaat
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
      {receiptMessage && <p role="status">{receiptMessage}</p>}
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
      <button type="button" onClick={() => { void downloadReceipt('html') }}>
        Bewaar printbaar volledig weekmandje (HTML)
      </button>
      <button type="button" onClick={() => { void handoffReceipt('copy') }}>
        Kopieer mijn volledige privéweekmand
      </button>
      <button type="button" onClick={() => { void handoffReceipt('share') }}>
        Deel privéweekmand via mijn apparaat
      </button>
      <small>Downloads, kopiëren en expliciet delen gebruiken het originele complete weekmandje en
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
