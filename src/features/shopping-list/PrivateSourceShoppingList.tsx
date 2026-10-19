import { euro as exactEuro } from '../../lib/money.ts'
import type { PrivateExtraVisitCostIntent } from '../comparison/privateExtraVisitCost.ts'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { BasketTraceLine, RecipeWithIngredients } from '../../domain/basket.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import { freshReviewedBaskets, privateReviewedPairWithin24Hours, type OwnStore, type PrivateReviewedBaskets, type PrivateRouteChoice } from '../comparison/privateReviewedBasketBridge.ts'
import { privateUnitPrice } from '../comparison/privateUnitPrice.ts'
import { extraGroceriesSavedEvent, readSavedExtrasForPlan } from '../comparison/ownExtraGroceriesStorage.ts'
import { privatePhysicalShoppingTick } from './privatePhysicalShoppingTick.ts'
import { compareFullBaskets } from '../../domain/basketComparison.ts'
import { createMixedStoreShoppingPlan, type MixedStoreLine } from '../comparison/mixedStoreShoppingPlan.ts'
import './privateSourceShoppingList.css'

const date = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })
const stores: OwnStore[] = ['PLUS', 'DekaMarkt']
const MixedStoreShoppingCard = lazy(async () => {
  const module = await import('../comparison/MixedStoreShoppingCard.tsx')
  return { default: module.MixedStoreShoppingCard }
})

/** Private owner-reviewed baskets only. No fixture rows, browser storage or APIs. */
export function PrivateSourceShoppingList({ reviewed, budget, preferred, onChooseStore, onOpenComparison, checked, setChecked, plan, recipes, activeDays, routeChoice, routeCostIntent, routeOpenSignal = 0 }: {
  reviewed: PrivateReviewedBaskets
  budget: number
  preferred: OwnStore
  onChooseStore: (store: OwnStore) => void
  onOpenComparison: () => void
  checked: Record<string, boolean>
  setChecked: Dispatch<SetStateAction<Record<string, boolean>>>
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
  routeOpenSignal?: number
  routeChoice?: PrivateRouteChoice | null
  routeCostIntent?: PrivateExtraVisitCostIntent | null
}) {
  const available = stores.filter(store => !!reviewed.stores[store])
  const store = available.includes(preferred) ? preferred : available[0]
  const capture = reviewed.stores[store]!
  const basket = capture.basket
  const [remainingOnly, setRemainingOnly] = useState(false)
  const [message, setMessage] = useState('')
  const [showMixedRoute, setShowMixedRoute] = useState(false)
  const [unpricedExtras, setUnpricedExtras] = useState<number | null>(() => {
    const saved = readSavedExtrasForPlan(reviewed.planKey)
    return saved.available ? saved.items.length : null
  })
  useEffect(() => {
    const refresh = () => {
      const saved = readSavedExtrasForPlan(reviewed.planKey)
      setUnpricedExtras(saved.available ? saved.items.length : null)
    }
    refresh()
    const onChanged = (event: Event) => {
      if ((event as CustomEvent<string>).detail === reviewed.planKey) refresh()
    }
    window.addEventListener(extraGroceriesSavedEvent, onChanged)
    return () => window.removeEventListener(extraGroceriesSavedEvent, onChanged)
  }, [reviewed.planKey])
  const mixedSectionRef = useRef<HTMLElement>(null)
  const progressInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (routeOpenSignal <= 0) return
    setShowMixedRoute(true)
    // The Planner deep link should land on the actual shopping route, not
    // only switch the tab while the route stays below the viewport.
    // When Producten supplied an exact ingredient/SKU intent, the child
    // highlights and scrolls to THAT line instead of this section header.
    if (routeChoice?.serial === routeOpenSignal) return
    const frame = window.requestAnimationFrame(() =>
      mixedSectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
    return () => window.cancelAnimationFrame(frame)
  }, [routeOpenSignal, routeChoice])
  // Physical checkmarks mean 'put this exact item in the trolley', NOT
  // approval of a price. A fresh reviewed price-only correction may update the
  // displayed cents without losing purchased-quantity progress in this session.
  // Week, store, SKU, quantity, pack, or matched state change -> a new key.
  const physicalTick = (name: OwnStore, shopId: string, line: BasketTraceLine) =>
    privatePhysicalShoppingTick(reviewed.planKey, name, shopId, line)
  const tick = (line: BasketTraceLine) => physicalTick(store, basket.store.id, line)
  const isSingleCheckedOnRoute = (item: MixedStoreLine): boolean => {
    const source = reviewed.stores[item.store]
    const line = source?.basket.lines.find(entry => entry.id === item.id)
    if (!source || !line || line.status !== 'matched' ||
        line.productId !== item.productId || line.productName !== item.productName ||
        line.packs !== item.packs || line.pack.amount !== item.packAmount ||
        line.pack.unit !== item.packUnit || line.pack.count !== item.packCount ||
        line.requirement.amount !== item.amount || line.requirement.unit !== item.unit) return false
    return checked[physicalTick(item.store, source.basket.store.id, line)] === true
  }
  const doneCount = basket.lines.filter(line => checked[tick(line)]).length
  const remainingCents = basket.lines.reduce((sum, line) =>
    sum + (line.status === 'matched' && !checked[tick(line)] ? line.lineTotalCents : 0), 0)
  const visibleLines = remainingOnly ? basket.lines.filter(line => !checked[tick(line)]) : basket.lines
  const readable = (value: string) => value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim()
  const label = (line: BasketTraceLine) => line.status === 'matched'
    ? readable(line.ingredientLabel) + ': ' + line.packs + ' × ' + readable(line.productName) +
      ' (SKU ' + readable(line.productId) + ') · ' +
      line.pack.count + ' × ' + line.pack.amount + ' ' + line.pack.unit + ' per pak · ' +
      exactEuro.formatCents(line.pricePerPackCents) + ' per pak · ' +
      (privateUnitPrice(line) ?? 'eenheidsprijs onbekend') + ' · ' +
      exactEuro.formatCents(line.lineTotalCents) + ' totaal'
    : line.ingredientLabel + ': product onbekend'
  const textList = [
    'Supa · ' + store + ' · privé gecontroleerd boodschappenlijstje',
    'Eigen bronopname: ' + readable(capture.observedAt),
    remainingOnly ? 'Alleen nog te kopen artikelen (niet het hele winkelmandje).' :
      'Volledig eigen winkelmandje, afgevinkte artikelen inbegrepen.',
    'Nog op lijst volgens eigen bron: ' + exactEuro.formatCents(remainingCents),
    ...visibleLines.map(line => (checked[tick(line)] ? '☑ ' : '☐ ') + label(line)),
    ...(remainingOnly && visibleLines.length === 0 ? ['Alles afgevinkt.'] : []),
    'Privébron. Geen actuele kassagarantie of publieke besparingsclaim.',
  ].join('\n')
  const plus = reviewed.stores.PLUS
  const deka = reviewed.stores.DekaMarkt
  const paired = !!plus && !!deka &&
    privateReviewedPairWithin24Hours(plus, deka)
  const comparison = paired
    ? compareFullBaskets({ baseline: plus!.basket, candidate: deka!.basket }) : null
  const pairReady = paired && comparison?.claimable === true && !!plus && !!deka
  const mixed = pairReady ? createMixedStoreShoppingPlan(plus!.basket, deka!.basket) : null
  const single = pairReady ? createMixedStoreShoppingPlan(plus!.basket, deka!.basket, 'single') : null
  // Reusing the same UI after a different verified SKU/physical pack must
  // not retain earlier route preferences or checked-item progress.
  const pairIdentity = pairReady ? JSON.stringify([reviewed.planKey,
    ...stores.map(name => [name, reviewed.stores[name]!.observedAt,
      reviewed.stores[name]!.basket.lines]),
  ]) : null
  const pairCurrentNow = () => {
    const current = freshReviewedBaskets(reviewed, reviewed.planKey, Date.now())
    if (!current?.stores.PLUS || !current.stores.DekaMarkt ||
        current.stores.PLUS !== plus || current.stores.DekaMarkt !== deka ||
        !privateReviewedPairWithin24Hours(current.stores.PLUS, current.stores.DekaMarkt)) return false
    return compareFullBaskets({ baseline: plus!.basket, candidate: deka!.basket }).claimable
  }
  const budgetCents = Number.isFinite(budget) ? Math.round(budget * 100) : null

  function currentCaptureAvailable() {
    const valid = freshReviewedBaskets(reviewed, reviewed.planKey, Date.now())?.stores[store]
    return !!valid && valid.observedAt === capture.observedAt && valid.basket === basket
  }
  async function bringUnpricedWeekChecks() {
    if (!currentCaptureAvailable()) {
      setMessage('Controleer eerst de actuele bronproducten voor deze winkel.')
      return
    }
    try {
      const { unpricedWeekToReviewedTicks } = await import('./unpricedWeekToReviewedTicks.ts')
      const imported = unpricedWeekToReviewedTicks({
        plan, recipes, activeDays, basket,
        read: key => window.sessionStorage.getItem(key),
      })
      if (!imported.checkedIds.length) {
        setMessage('Geen afgevinkte artikelen gevonden in de ongeprijsde Planner-weeklijst van dit browsertabblad.')
        return
      }
      if (!window.confirm(imported.checkedIds.length + ' van ' + imported.total +
        ' al afgevinkte fysieke Planner-boodschappen toevoegen aan jouw ' + store +
        '-lijst? Je bestaande vinkjes blijven behouden. Dit bevestigt geen prijs of betaling.')) return
      if (!currentCaptureAvailable()) throw Error('De bron is inmiddels verlopen.')
      // A changed current week must never inherit completion from the former.
      const current = unpricedWeekToReviewedTicks({
        plan, recipes, activeDays, basket,
        read: key => window.sessionStorage.getItem(key),
      })
      if (JSON.stringify(current.checkedIds) !== JSON.stringify(imported.checkedIds))
        throw Error('De Planner-vinkjes zijn ondertussen gewijzigd.')
      setChecked(before => ({
        ...before,
        ...Object.fromEntries(imported.checkedIds.map(id => {
          const line = basket.lines.find(row => row.id === id)!
          return [tick(line), true]
        })),
      }))
      setMessage(imported.checkedIds.length + ' vinkjes toegevoegd vanuit je eigen ongeprijsde weeklijst.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Overnemen van Planner-vinkjes is niet gelukt.')
    }
  }
  function downloadList() {
    if (!currentCaptureAvailable()) {
      setMessage('De bronopname is inmiddels verlopen. Werk je eigen winkelprijzen opnieuw bij in Vergelijk.')
      return
    }
    try {
      const url = URL.createObjectURL(new Blob([textList], { type: 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-' + store.toLowerCase() + '-eigen-boodschappen.txt'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
        setMessage('Je actuele lokale boodschappenlijst is gedownload; niets verzonden.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch { setMessage('Download niet beschikbaar. Kopieer de lijst hieronder.') }
  }
  async function downloadStoreWithExtras() {
    // Merge only presentation, not price arithmetic. The reviewed retailer
    // receipt and the private extras remain separate evidence categories.
    if (!currentCaptureAvailable()) {
      setMessage('De winkelopname is verlopen. Herzie eerst je eigen prijzen.')
      return
    }
    try {
      const { readSavedExtrasForPlan } = await import('../comparison/ownExtraGroceriesStorage.ts')
      const saved = readSavedExtrasForPlan(reviewed.planKey)
      if (!saved.available) {
        setMessage('Extra boodschappen van deze week zijn niet veilig leesbaar. Niets gedownload.')
        return
      }
      if (!saved.items.length) {
        setMessage('Voeg onderaan Lijst eerst eigen extra boodschappen toe en klik Bewaar in deze tab. Daarna kun je één gezamenlijke lijst downloaden.')
        return
      }
      if (!currentCaptureAvailable()) throw Error('De oorspronkelijke winkelopname is inmiddels verlopen.')
      const extraLines = saved.items.map(item =>
        (item.done ? '☑ ' : '☐ ') + readable(item.name) + ' · ' +
        String(item.quantity).replace('.', ',') + ' ' +
        (item.unit === 'piece' ? 'stuks' : item.unit) +
        ' · winkel en prijs onbekend')
      const all = [
        textList,
        '',
        'EIGEN EXTRA BOODSCHAPPEN (' + saved.items.length + ', expliciet in deze tab bewaard)',
        'Niet gekoppeld aan PLUS of DekaMarkt. Buiten alle getoonde eurototalen en besparingen.',
        ...extraLines,
        '',
        'De winkelbedragen hierboven zijn uitsluitend voor de eigen gecontroleerde',
        'fysieke Planner-producten; deze extra boodschappen hebben onbekende kosten.',
      ].join('\n')
      if (new TextEncoder().encode(all).length > 128_000)
        throw Error('Deze gecombineerde lokale lijst is te groot.')
      if (!currentCaptureAvailable()) throw Error('De bron is veranderd tijdens exporteren.')
      const url = URL.createObjectURL(new Blob([all], { type: 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-' + store.toLowerCase() + '-met-eigen-extra-boodschappen.txt'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
        setMessage('Eigen gecontroleerde ' + store + '-lijst inclusief apart bewaarde ongeprijsde extras gedownload. Je getoonde winkelbedrag is exclusief extras.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch {
      setMessage('Gecombineerde export niet beschikbaar: controleer de bron en je opgeslagen extra artikelen.')
    }
  }
  async function downloadCsv(includeExtras = false) {
    if (!currentCaptureAvailable()) {
      setMessage('De eigen bronopname is verlopen. Herzie de oorspronkelijke prijzen voordat je CSV downloadt.')
      return
    }
    try {
      const { privateSingleStoreShoppingCsv } = await import('./privateSourceShoppingCsv.ts')
      // Avoid a stale asynchronous export across a newly expired source moment.
      if (!currentCaptureAvailable()) throw Error('Bronopname inmiddels verlopen.')
      const reviewedCsv = privateSingleStoreShoppingCsv({ basket, observedAt: capture.observedAt,
        done: new Set(basket.lines.filter(line => checked[tick(line)]).map(line => line.id)),
      })
      let csv = reviewedCsv
      if (includeExtras) {
        const [{ readSavedExtrasForPlan }, { appendUnpricedExtrasToSingleStoreCsv }] =
          await Promise.all([
            import('../comparison/ownExtraGroceriesStorage.ts'),
            import('./singleStoreWithExtrasCsv.ts'),
          ])
        const saved = readSavedExtrasForPlan(reviewed.planKey)
        if (!saved.available || !saved.items.length)
          throw Error('Bewaar eerst je eigen extra boodschappen voor deze week in de Lijst-tab.')
        csv = appendUnpricedExtrasToSingleStoreCsv(reviewedCsv, saved.items)
      }
      if (!currentCaptureAvailable()) throw Error('De originele bron is intussen verlopen.')
      const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-' + store.toLowerCase() +
          (includeExtras ? '-met-ongeprijsde-extras.csv' : '-eigen-boodschappen.csv')
        document.body.append(link)
        try { link.click() } finally { link.remove() }
        setMessage('Eigen artikelen, hele verpakkingen en exacte centprijzen lokaal als CSV opgeslagen.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'De privé-CSV kon niet worden gemaakt.')
    }
  }
  async function downloadPrintable(includeExtras = false) {
    if (!currentCaptureAvailable()) {
      setMessage('De bron is verlopen. Herzie eerst de winkelprijzen.')
      return
    }
    try {
      const { privateSingleStorePrintableHtml } = await import('./privateSingleStorePrintableHtml.ts')
      let extras: import('../comparison/ownExtraGroceriesStorage.ts').Item[] | undefined
      if (includeExtras) {
        const { readSavedExtrasForPlan } = await import('../comparison/ownExtraGroceriesStorage.ts')
        const saved = readSavedExtrasForPlan(reviewed.planKey)
        if (!saved.available || !saved.items.length)
          throw Error('Bewaar je eigen extra boodschappen in de Lijst-tab voordat je ze print.')
        extras = saved.items
      }
      if (!currentCaptureAvailable()) throw Error('Verlopen bron')
      const html = privateSingleStorePrintableHtml({
        basket, observedAt: capture.observedAt,
        done: new Set(basket.lines.filter(line => checked[tick(line)]).map(line => line.id)),
        extras,
      })
      if (!currentCaptureAvailable()) throw Error('Verlopen bron tijdens afdruk.')
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-' + store.toLowerCase() +
          (includeExtras ? '-met-ongeprijsde-extra-boodschappen.html' : '-boodschappenlijst.html')
        document.body.append(link)
        try { link.click() } finally { link.remove() }
        setMessage('Printbare offline lijst lokaal opgeslagen. Open het HTML-bestand en druk af.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch { setMessage('Deze eigen winkelbron kon niet veilig worden afgedrukt.') }
  }
  async function saveProgress() {
    if (!currentCaptureAvailable()) {
      setMessage('De winkelbron is verlopen. Werk de brongegevens bij.')
      return
    }
    try {
      const { exportSingleStoreProgress } = await import('./privateSingleStoreProgress.ts')
      if (!currentCaptureAvailable()) throw Error('Verlopen bron')
      const data = exportSingleStoreProgress({
        planKey: reviewed.planKey, store, capture,
        done: new Set(basket.lines.filter(line => checked[tick(line)]).map(line => line.id)),
      })
      const url = URL.createObjectURL(new Blob([data], { type: 'application/json;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-' + store.toLowerCase() + '-afvinkingen.json'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
        setMessage('Vinkjes lokaal bewaard in je eigen bestand; niets verzonden.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch { setMessage('Kon je afvinkingen niet veilig bewaren.') }
  }
  async function restoreProgress(file: File) {
    if (!currentCaptureAvailable() || file.size > 256_000) {
      setMessage('Controleer je bron. Herstelbestanden mogen maximaal 256 kB zijn.')
      return
    }
    try {
      const text = await file.text()
      const { importSingleStoreProgress } = await import('./privateSingleStoreProgress.ts')
      if (!currentCaptureAvailable()) throw Error('Verlopen bron')
      const restored = importSingleStoreProgress(text, { planKey: reviewed.planKey, store, capture })
      if (!window.confirm('Bestaande vinkjes van ' + store + ' vervangen door ' +
          restored.size + ' vinkjes uit je eigen bestand?')) {
        setMessage('Herstel geannuleerd; bestaande vinkjes behouden.')
        return
      }
      if (!currentCaptureAvailable()) throw Error('Verlopen bron')
      setChecked(before => {
        const next = { ...before }
        for (const line of basket.lines) next[tick(line)] = restored.has(line.id)
        return next
      })
      setMessage(restored.size + ' vinkjes hersteld voor exact hetzelfde eigen winkelmandje.')
    } catch { setMessage('Herstel geweigerd: bestand, week, bron, producten of prijzen verschillen.') }
  }
  return (
    <section className="screen private-source-shopping" aria-label="Eigen gecontroleerde boodschappenlijst">
      <header>
        <span className="eyebrow">Eigen gecontroleerde winkelbron</span>
        <h2>Boodschappenlijst</h2>
        <p>Je bevestigde winkelartikelen uit de Vergelijk-tab. Geen Supa-voorbeeldprijzen,
          automatische winkelupdates of opslag van privéprijzen.</p>
      </header>
      <label className="private-source-shopping__choose">Winkel met gecontroleerd volledig mandje
        <select value={store} onChange={event => {
          onChooseStore(event.currentTarget.value as OwnStore); setMessage('')
        }}>
          {available.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <div className="private-source-shopping__summary">
        <p><strong>{store}</strong> · bron van {date.format(new Date(capture.capturedMs))}</p>
        <strong>{exactEuro.formatCents(basket.totalCents)}</strong>
        <p>{basket.lines.length} ingrediënten · {doneCount} afgevinkt</p>
        <progress className="private-source-shopping__progress" value={doneCount}
          max={basket.lines.length} aria-label={'Afgevinkte ' + store + '-boodschappen'} />
        <p><strong>Nog op je lijst: {exactEuro.formatCents(remainingCents)}</strong>
          <small>Vinkjes betekenen niet dat producten zijn betaald.</small></p>
        {budgetCents !== null && budgetCents >= 0 &&
          <p>{basket.totalCents <= budgetCents
            ? exactEuro.formatCents((budgetCents - basket.totalCents)) + ' onder je Planner-weekbudget voor alléén bekende geprijsde ingrediënten'
            : exactEuro.formatCents((basket.totalCents - budgetCents)) + ' boven je Planner-weekbudget voor alléén bekende geprijsde ingrediënten'}</p>}
        {unpricedExtras !== null && unpricedExtras > 0 && <p role="status">
          Je hebt daarnaast {unpricedExtras} eigen ongeprijsde boodschappen. Deze horen
          niet bij het berekende winkelmandje; de echte totale weekuitgaven en
          resterende budgetruimte blijven <strong>onbekend</strong>.
        </p>}
        {unpricedExtras === null && <p role="status">De opgeslagen extra boodschappen
          zijn niet leesbaar; je uiteindelijke totale budgetruimte is onbekend.</p>}
        <small>Alleen hele verpakkingen in eigen bronopname. Geen actuele kassagarantie.</small>
      </div>
      {comparison?.claimable && comparison.deltaCents !== null &&
        <p role="status" className="private-source-shopping__comparison">
          {comparison.deltaCents === 0 ? 'Beide eigen winkelmandjes hebben hetzelfde totaal.'
            : (comparison.deltaCents > 0 ? 'PLUS' : 'DekaMarkt') + ' is ' +
              exactEuro.formatCents(Math.abs(comparison.deltaCents)) +
              ' goedkoper volgens jouw twee lokale, binnen 24 uur waargenomen bronnen.'}
          <small>Geen onafhankelijk gecontroleerde besparing.</small>
        </p>}
      {comparison?.claimable && plus && deka && <div
        className="private-source-shopping__store-switch" aria-label="Vergelijk hele winkelmandjes">
        {stores.map(name => {
          const source = reviewed.stores[name]!
          return <div key={name}>
            <strong>{name}</strong>
            <span>{exactEuro.formatCents(source.basket.totalCents)}</span>
            <small>Eigen opname: {date.format(new Date(source.capturedMs))}</small>
            <button type="button" disabled={store === name} onClick={() => {
              const current = freshReviewedBaskets(reviewed, reviewed.planKey, Date.now())
              if (!current?.stores.PLUS || !current.stores.DekaMarkt ||
                  !privateReviewedPairWithin24Hours(current.stores.PLUS, current.stores.DekaMarkt) ||
                  !compareFullBaskets({
                    baseline: current.stores.PLUS.basket,
                    candidate: current.stores.DekaMarkt.basket,
                  }).claimable) {
                setMessage('Deze vergelijking is verlopen. Controleer de winkelbronnen opnieuw.')
                return
              }
              onChooseStore(name)
              setMessage('Je kijkt nu naar jouw ' + name + '-lijst voor hetzelfde weekmenu.')
            }}>{store === name ? 'Dit is mijn huidige lijst' : 'Open mijn ' + name + '-lijst'}</button>
          </div>
        })}
      </div>}
      {mixed && single && plus && deka && <section ref={mixedSectionRef} className="private-source-shopping__mixed" aria-label="Combineer beide eigen winkelmandjes">
        <h3>Goedkoopste artikelen combineren</h3>
        <p>Verdeel alleen jouw gecontroleerde hele verpakkingen over beide winkels.
          De productkosten bedragen {exactEuro.formatCents(mixed.totalCents)}.
          {mixed.lines.some(line => line.store === 'PLUS') && mixed.lines.some(line => line.store === 'DekaMarkt')
            ? ' Extra bezoekkosten en reistijd moet je zelf invullen; zonder die kosten is het netto voordeel onbekend.'
            : ' Voor de goedkoopste combinatie is maar één winkel nodig.'}</p>
        <button type="button" aria-expanded={showMixedRoute} aria-controls="supa-mixed-shopping-list"
          onClick={() => setShowMixedRoute(value => !value)}>
          {showMixedRoute ? 'Verberg gecombineerde route' : 'Open gecombineerde winkelroute'}
        </button>
        <div id="supa-mixed-shopping-list" hidden={!showMixedRoute}>
          {showMixedRoute && <Suspense fallback={<p role="status">Jouw gecontroleerde winkelroute openen…</p>}>
            <MixedStoreShoppingCard key={pairIdentity ?? ''} mixed={mixed} single={single}
              plus={plus.basket} deka={deka.basket}
              captured={{ PLUS: plus.observedAt, DekaMarkt: deka.observedAt }}
              eligibleNow={pairCurrentNow} weekBudget={budget}
              plannerPlan={plan} plannerRecipes={recipes} plannerActiveDays={activeDays}
              privatePlanKey={reviewed.planKey}
              isSingleCheckedOnRoute={isSingleCheckedOnRoute}
              routeChoice={routeChoice?.planKey === reviewed.planKey ? routeChoice : null}
              routeCostIntent={routeCostIntent?.planKey === reviewed.planKey &&
                routeCostIntent.observedAt.PLUS === plus.observedAt &&
                routeCostIntent.observedAt.DekaMarkt === deka.observedAt
                ? routeCostIntent : null} />
          </Suspense>}
        </div>
      </section>}
      <div className="private-source-shopping__actions">
        <label><input type="checkbox" checked={remainingOnly}
          onChange={event => setRemainingOnly(event.target.checked)} /> Alleen nog te kopen</label>
        <button type="button" onClick={() => {
          if (doneCount === basket.lines.length) {
            setChecked(before => {
              const next = { ...before }
              for (const line of basket.lines) delete next[tick(line)]
              return next
            })
            setMessage('Alle vinkjes voor ' + store + ' zijn gewist.')
          } else if (window.confirm('Alle ' + basket.lines.length + ' artikelen van ' +
            store + ' afvinken? Dit is geen betaalbevestiging.')) {
            setChecked(before => ({
              ...before,
              ...Object.fromEntries(basket.lines.map(line => [tick(line), true])),
            }))
            setMessage(store + ': artikelen van jouw fysieke lijst afgevinkt.')
          }
        }}>{doneCount === basket.lines.length
          ? 'Vinkjes bij ' + store + ' wissen'
          : 'Alle ' + store + '-artikelen afvinken'}</button>
        <button type="button" onClick={() => { void bringUnpricedWeekChecks() }}>
          Neem vinkjes uit mijn ongeprijsde Planner-lijst over
        </button>
        <button type="button" onClick={downloadList}>Download eigen boodschappenlijst (TXT)</button>
        <button type="button" onClick={() => { void downloadStoreWithExtras() }}>
          Download winkelmand + mijn bewaarde extra boodschappen (TXT)
        </button>
        <button type="button" onClick={() => { void downloadCsv(false) }}>Download volledig mandje met SKU’s (CSV)</button>
        <button type="button" onClick={() => { void downloadCsv(true) }}>
          Download dit winkelmandje + ongeprijsde extras (CSV)
        </button>
        <button type="button" onClick={() => { void downloadPrintable(false) }}>Print volledig eigen mandje (HTML)</button>
        <button type="button" onClick={() => { void downloadPrintable(true) }}>
          Print dit winkelmandje én mijn extra boodschappen (HTML)
        </button>
        <button type="button" onClick={() => { void saveProgress() }}>Bewaar vinkjes (JSON)</button>
        <button type="button" onClick={() => progressInputRef.current?.click()}>Herstel vinkjes</button>
        <input ref={progressInputRef} type="file" accept=".json,application/json"
          aria-label="Kies je eigen Supa-afvinkbestand" className="private-source-shopping__backup-input"
          onChange={event => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void restoreProgress(file)
          }} />
        <button type="button" onClick={onOpenComparison}>Herzie prijzen en productmatching</button>
      </div>
      <p role="status" aria-live="polite">{message}</p>
      <div className="private-source-shopping__items">
        {visibleLines.map(line => (
          <label className="private-source-shopping__item" key={line.id}>
            <input type="checkbox" checked={!!checked[tick(line)]}
              onChange={event => { const value = event.currentTarget.checked
                setChecked(before => ({ ...before, [tick(line)]: value })) }} />
            <span><strong>{line.ingredientLabel}</strong>
              <small>{line.status === 'matched'
                ? line.packs + ' × ' + line.productName + ' · SKU ' + line.productId +
                  ' · ' + line.pack.amount + ' ' + line.pack.unit + ' × ' + line.pack.count + ' per verpakking' +
                  ' · ' + exactEuro.formatCents(line.pricePerPackCents) + ' per pak' +
                  ' · ' + (privateUnitPrice(line) ?? 'eenheidsprijs onbekend')
                : 'Dit product is niet betrouwbaar gekoppeld.'}</small>
            </span>
            <strong>{line.status === 'matched' ? exactEuro.formatCents(line.lineTotalCents) : 'Onbekend'}</strong>
          </label>
        ))}
        {visibleLines.length === 0 && <p>Alles voor {store} is afgevinkt.</p>}
      </div>
      <details>
        <summary>{remainingOnly ? 'Kopieer alleen nog te kopen artikelen' :
          'Kopieer het volledige eigen winkelmandje'}</summary>
        <textarea readOnly value={textList} rows={Math.min(16, basket.lines.length + 4)}
          onFocus={event => {
            if (currentCaptureAvailable()) event.currentTarget.select()
            else { event.currentTarget.blur(); setMessage('Deze winkelopname is verlopen. Werk de brongegevens bij.') }
          }}
          aria-label="Kopieerbare eigen boodschappenlijst" />
      </details>
      <p className="disclaimer">De gezamenlijke TXT-export bevat uitsluitend de
        extra boodschappen die je apart hebt bewaard in dit browsertabblad. Niet bewaarde
        wijzigingen zijn geen onderdeel van die export. Extras blijven ongeprijsd en
        worden niet bij de gecontroleerde mandbedragen opgeteld.</p>
      <p className="disclaimer">Het TXT-bestand en de kopieerbare lijst volgen de optie
        'Alleen nog te kopen'. CSV en printbare HTML bevatten bewust het volledige
        persoonlijk gecontroleerde mandje, met alle vinkjes en bronbedragen.</p>
      <p className="disclaimer">Vinkjes worden niet automatisch opgeslagen of doorgestuurd. Met Bewaar kun je
        zelf een lokaal JSON-bestand maken en later terugzetten. Een nieuwe week, andere winkel,
        SKU, benodigde hoeveelheid of fysieke verpakking reset de vinkjes. Een prijswijziging
        laat alleen de fysieke vinkjes in deze sessie staan; nieuwe bronprijzen vereisen opnieuw review.</p>
    </section>
  )
}
