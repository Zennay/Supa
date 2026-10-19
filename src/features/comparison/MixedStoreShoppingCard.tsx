import { useEffect, useMemo, useRef, useState } from 'react'
import type { OneStoreBasket, RecipeWithIngredients } from '../../domain/basket.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import type { MixedStoreShoppingPlan, MixedStore, MixedStoreLine } from './mixedStoreShoppingPlan.ts'
import { createMixedStoreShoppingPlan, formatMixedStoreShoppingPlan } from './mixedStoreShoppingPlan.ts'
import { MixedTripBackupControls } from './MixedTripBackupControls.tsx'
import { PrivateRouteExtraGroceries } from './PrivateRouteExtraGroceries.tsx'
import { MixedStoreUnitBreakdown } from './MixedStoreUnitBreakdown.tsx'
import { exportMixedStoreRouteCsv } from './mixedStoreRouteCsv.ts'
import { printMixedStoreRouteHtml } from './mixedStorePrintHtml.ts'
import { validCustomWeekBudgetEuros } from '../planner/customWeekBudget.ts'
import { parsePrivateExtraVisitCostCents, type PrivateExtraVisitCostIntent } from './privateExtraVisitCost.ts'
import type { PrivateRouteChoice } from './privateReviewedBasketBridge.ts'

const money = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const stores: MixedStore[] = ['PLUS', 'DekaMarkt']

/** Renders only a reviewed, timely, same-demand comparison. Never loads
 * another retailer or turns a missing observed price into a cheaper option.
 * Download/copy still requires the parent source gate at click time.
 */
export function MixedStoreShoppingCard({
  mixed, single, plus, deka, captured, eligibleNow, weekBudget,
  plannerPlan, plannerRecipes, plannerActiveDays, privatePlanKey, isSingleCheckedOnRoute, routeChoice, routeCostIntent,
}: {
  mixed: MixedStoreShoppingPlan
  single: MixedStoreShoppingPlan
  plus: OneStoreBasket
  deka: OneStoreBasket
  captured: Record<MixedStore, string>
  eligibleNow: () => boolean
  weekBudget?: number
  plannerPlan?: PlannedMeal[]
  plannerRecipes?: RecipeWithIngredients[]
  plannerActiveDays?: string[]
  privatePlanKey?: string
  isSingleCheckedOnRoute?: (line: MixedStoreLine) => boolean
  routeChoice?: PrivateRouteChoice | null
  routeCostIntent?: PrivateExtraVisitCostIntent | null
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [extraCount, setExtraCount] = useState(0)
  const [showText, setShowText] = useState(false)
  const [message, setMessage] = useState('')
  const [extraVisitCost, setExtraVisitCost] = useState('')
  const [mode, setMode] = useState<'auto' | 'mixed' | 'single'>('auto')
  const [preferred, setPreferred] = useState<Record<string, MixedStore>>({})
  const selectedLineRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (!routeCostIntent) return
    if (!eligibleNow() ||
        routeCostIntent.observedAt.PLUS !== captured.PLUS ||
        routeCostIntent.observedAt.DekaMarkt !== captured.DekaMarkt ||
        parsePrivateExtraVisitCostCents(routeCostIntent.raw) === null) {
      setMessage('De eerdere Planner-kostenkeuze hoort niet bij deze bronopnames. Voer je extra kosten opnieuw in.')
      return
    }
    // An explicit own cost, not a product price: only apply once to the
    // exact matching reviewed two-store receipts and same Planner demand.
    setExtraVisitCost(routeCostIntent.raw)
    setMode('auto')
    setMessage('De eerder door jou ingevulde extra kosten van de tweede stop zijn meegenomen.')
  }, [routeCostIntent?.serial, captured.PLUS, captured.DekaMarkt])

  const chosenMixed = useMemo(() => createMixedStoreShoppingPlan(plus, deka, 'mixed', preferred),
    [plus, deka, preferred])
  useEffect(() => {
    if (!routeChoice) return
    if (!eligibleNow() ||
        routeChoice.observedAt.PLUS !== captured.PLUS ||
        routeChoice.observedAt.DekaMarkt !== captured.DekaMarkt) {
      setMessage('Deze winkelkeuze is niet meer actueel. Herzie eerst je eigen bronnen.')
      return
    }
    // Reconstruct exactly the ORIGINAL reviewed selected SKU / whole-pack
    // price. Never trust a stale route intent or the Producten search filter.
    const intended = createMixedStoreShoppingPlan(
      plus, deka, 'mixed', { [routeChoice.ingredientId]: routeChoice.store })
    const line = intended?.lines.find(item =>
      item.id === routeChoice.ingredientId && item.store === routeChoice.store)
    if (!line || line.key !== routeChoice.lineKey) {
      setMessage('Het bronproduct of de verpakking is gewijzigd. Kies het artikel opnieuw.')
      return
    }
    setPreferred(before => ({ ...before, [line.id]: routeChoice.store }))
    setMode('mixed')
    setOnlyOpen(false)
    setShowText(false)
    setMessage('Jouw originele ' + routeChoice.store + '-artikel voor ' +
      line.ingredientLabel + ' is geselecteerd. De volledige route is herberekend.')
  }, [routeChoice?.serial, plus, deka, captured.PLUS, captured.DekaMarkt])
  // Source comparisons are prevalidated. A malformed choice must not quietly
  // become an apparently reviewed custom basket.
  const selectedMixed = chosenMixed ?? mixed

  // An explicit preferred store can introduce a second visit even when the
  // cheapest-by-line route would only use one store. Cost entry must follow
  // this *actual* proposed route, never only the theoretical minimum.
  const mixedUsesBoth = stores.every(store =>
    selectedMixed.lines.some(line => line.store === store))
  // Even if the hypothetical mixed candidate has two shops, selecting
  // explicit single-shop mode must not prompt for a second stop or count
  // stale editing input as a cost for the selected route.
  const canEditSecondStop = mixedUsesBoth && mode !== 'single'
  const rawCost = extraVisitCost.trim()
  const parsedCost = parsePrivateExtraVisitCostCents(rawCost)
  const extraCostCents = canEditSecondStop ? parsedCost : null
  const costInvalid = canEditSecondStop && rawCost !== '' && parsedCost === null
  const suggestedSingle = selectedMixed.additionalDifferenceCents <= 0 ||
    (extraCostCents !== null && extraCostCents >= selectedMixed.additionalDifferenceCents)
  const chooseSingle = mode === 'single' || (mode === 'auto' && suggestedSingle)
  const plan = chooseSingle ? single : selectedMixed
  useEffect(() => {
    if (!routeChoice || mode !== 'mixed' ||
        !plan.lines.some(line => line.key === routeChoice.lineKey)) return
    const frame = window.requestAnimationFrame(() =>
      selectedLineRef.current?.scrollIntoView({
        block: 'center', behavior: 'smooth',
      }))
    return () => window.cancelAnimationFrame(frame)
  }, [routeChoice?.serial, mode, plan])
  const visitsBoth = stores.every(store => plan.lines.some(line => line.store === store))
  const appliedCostCents = visitsBoth ? extraCostCents : null
  const validBudget = validCustomWeekBudgetEuros(weekBudget)
  const weekBudgetCents = validBudget === null ? null : Math.round(validBudget * 100)
  // A two-stop route cannot assert budget headroom until its extra visit
  // costs are explicitly supplied. One-store routes need no second stop.
  const routeWithCostCents = visitsBoth
    ? extraCostCents === null ? null : plan.totalCents + extraCostCents
    : plan.totalCents
  const netAdvantage = extraCostCents === null ? null :
    selectedMixed.additionalDifferenceCents - extraCostCents
  const key = (id: string) => JSON.stringify([captured.PLUS, captured.DekaMarkt, id])
  const done = (id: string) => !!checked[key(id)]
  const progress = Object.fromEntries(plan.lines.map(line => [line.key, done(line.key)]))
  const doneCount = plan.lines.filter(line => progress[line.key]).length
  const perStoreProgress = Object.fromEntries(stores.map(store => {
    const lines = plan.lines.filter(line => line.store === store)
    const doneLines = lines.filter(line => progress[line.key])
    const totalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0)
    const remainingCents = lines.filter(line => !progress[line.key])
      .reduce((sum, line) => sum + line.lineTotalCents, 0)
    return [store, { count: lines.length, done: doneLines.length, totalCents, remainingCents }]
  })) as Record<MixedStore, {
    count: number; done: number; totalCents: number; remainingCents: number
  }>
  const remainingProductCents = stores.reduce(
    (sum, store) => sum + perStoreProgress[store].remainingCents, 0)
  const printable = formatMixedStoreShoppingPlan(plan, captured, progress, appliedCostCents, onlyOpen)
  const block = costInvalid && !chooseSingle

  function importSingleStoreChecks() {
    if (!isSingleCheckedOnRoute || !eligibleNow()) {
      setMessage('Open een geldige eigen winkelbron voordat je afvinkingen overneemt.')
      return
    }
    const candidates = plan.lines.filter(line => isSingleCheckedOnRoute(line) && !done(line.key))
    if (!candidates.length) {
      setMessage('Geen nieuwe passende afvinkingen uit je eigen één-winkellijsten beschikbaar.')
      return
    }
    if (!window.confirm('Voeg ' + candidates.length +
      ' afgevinkte artikelen uit je eigen gecontroleerde winkellijsten toe aan deze route?' +
      ' Alleen exact dezelfde winkel, SKU, verpakking en hoeveelheid gelden; geen prijsgoedkeuring.')) return
    if (!eligibleNow()) {
      setMessage('De bronopnames zijn gewijzigd of verlopen. Controleer ze opnieuw.')
      return
    }
    const current = plan.lines.filter(line => isSingleCheckedOnRoute(line) && !done(line.key))
    if (current.length !== candidates.length ||
        current.some((line, index) => line.key !== candidates[index].key)) {
      setMessage('De lijst is ondertussen gewijzigd. Herhaal het overnemen.')
      return
    }
    setChecked(before => ({
      ...before, ...Object.fromEntries(current.map(line => [key(line.key), true])),
    }))
    setMessage(current.length + ' exact passende winkelvinkjes toegevoegd aan deze route.')
  }

  async function importPlannerChecks() {
    if (!plannerPlan || !plannerRecipes || !plannerActiveDays) return
    if (!eligibleNow()) {
      setMessage('Controleer eerst de actuele originele bronopnames.')
      return
    }
    try {
      const { unpricedWeekToReviewedTicks } = await import('../shopping-list/unpricedWeekToReviewedTicks.ts')
      const source = unpricedWeekToReviewedTicks({
        plan: plannerPlan, recipes: plannerRecipes, activeDays: plannerActiveDays,
        basket: plus, read: key => window.sessionStorage.getItem(key),
      })
      if (!source.checkedIds.length) {
        setMessage('Geen afvinkingen uit dit exacte ongeprijsde weekmenu gevonden in deze browsertab.')
        return
      }
      if (!window.confirm('Neem ' + source.checkedIds.length +
        ' fysieke Planner-vinkjes over naar de huidige route? Je bevestigt geen winkels, prijzen of betalingen.')) return
      if (!eligibleNow()) throw Error('Deze bronopnames zijn inmiddels verlopen.')
      const latest = unpricedWeekToReviewedTicks({
        plan: plannerPlan, recipes: plannerRecipes, activeDays: plannerActiveDays,
        basket: plus, read: key => window.sessionStorage.getItem(key),
      })
      if (JSON.stringify(latest.checkedIds) !== JSON.stringify(source.checkedIds))
        throw Error('De Planner-vinkjes zijn ondertussen gewijzigd.')
      const allowed = new Set(source.checkedIds)
      setChecked(before => ({ ...before, ...Object.fromEntries(plan.lines
        .filter(line => allowed.has(line.id)).map(line => [key(line.key), true])) }))
      setMessage('Fysieke Planner-vinkjes voor deze route overgenomen; prijsreviews blijven onafhankelijk.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Kon de Planner-vinkjes niet overnemen.')
    }
  }

  function download() {
    if (block) {
      setMessage('Corrigeer eerst je extra bezoekkosten, of kies alleen de goedkoopste complete winkel.')
      return
    }
    if (!eligibleNow()) {
      setShowText(false)
      setMessage('Deze originele bronopnames zijn verlopen of de productcontrole is gewijzigd. Controleer de echte bron opnieuw.')
      return
    }
    try {
      const url = URL.createObjectURL(new Blob([printable], { type: 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-mijn-winkelroute-prive.txt'
        document.body.appendChild(link)
        try { link.click() } finally { link.remove() }
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      setMessage('De gekozen route met jouw persoonlijke bronartikelen is lokaal opgeslagen. Geen onafhankelijke retailerprijzen.')
    } catch {
      setMessage('Download mislukt. Je kunt de route ook lokaal selecteren en kopiëren.')
    }
  }

  async function downloadRouteWithExtras() {
    if (!privatePlanKey || block || !eligibleNow()) { setMessage('Herzie eerst het exacte Planner-weekmandje, de bronnen en kosten.'); return }
    try {
      const { readSavedExtrasForPlan } = await import('./ownExtraGroceriesStorage.ts')
      const saved = readSavedExtrasForPlan(privatePlanKey)
      if (!saved.available) { setMessage('Extra lijst is niet veilig leesbaar.'); return }
      if (!saved.items.length) {
        setMessage('Bewaar jouw extra boodschappen onderaan Lijst eerst in dit tabblad.')
        return
      }
      const visible = onlyOpen ? saved.items.filter(item => !item.done) : saved.items
      const clean = (value: string) => value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim()
      const complete = [printable, '',
        'EIGEN EXTRA BOODSCHAPPEN (' + saved.items.length + ' apart bewaard)',
        'Geen gekoppelde winkel, bronprijs, pakprijs of bijdrage aan bovenstaand prijsverschil.',
        ...visible.map(item => (item.done ? '☑ ' : '☐ ') + clean(item.name) +
          ' · ' + item.quantity + ' ' + (item.unit === 'piece' ? 'stuks' : item.unit) +
          ' · prijs onbekend'),
        'Bovenstaande bedragen omvatten uitsluitend het geprijsde Planner-weekmandje.',
      ].join('\n')
      if (new TextEncoder().encode(complete).length > 128000 || !eligibleNow())
        throw Error('Bron of lijst is niet meer geldig.')
      const url = URL.createObjectURL(new Blob([complete], { type: 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a'); link.href = url
        link.download = 'supa-winkelroute-plus-ongeprijsde-extra-boodschappen.txt'
        document.body.append(link); try { link.click() } finally { link.remove() }
        setMessage('Gecombineerde privéroute opgeslagen. De extras tellen niet mee in eurototalen.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch { setMessage('Controleer je bron en eigen extra boodschappen voor export.') }
  }

  function downloadRouteCsv() {
    if (block || !eligibleNow()) {
      setMessage('Controleer eerst alle originele bronartikelen en de eventueel opgegeven extra kosten.')
      return
    }
    try {
      const csv = exportMixedStoreRouteCsv({
        plus, deka, route: plan, captured,
        checked: new Set(plan.lines.filter(line => done(line.key)).map(line => line.key)),
        extraVisitCostCents: appliedCostCents, strategy: mode,
      })
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-mijn-gekozen-winkelroute-prive.csv'
        document.body.appendChild(link)
        try { link.click() } finally { link.remove() }
        setMessage('De gekozen winkelroute is met beide originele productprijzen als veilige lokale CSV bewaard.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Deze privéwinkelroute kan niet worden geëxporteerd.')
    }
  }

  async function downloadRouteCsvWithExtras() {
    if (!privatePlanKey || block || !eligibleNow()) {
      setMessage('Herzie de exacte Planner-week, eigen bronopnames en extra kosten.')
      return
    }
    try {
      const [{ readSavedExtrasForPlan }, { appendUnpricedExtrasToMixedRouteCsv }] =
        await Promise.all([
          import('./ownExtraGroceriesStorage.ts'),
          import('./mixedStoreWithExtrasCsv.ts'),
        ])
      const saved = readSavedExtrasForPlan(privatePlanKey)
      if (!saved.available || !saved.items.length) {
        setMessage('Bewaar eerst je eigen extra boodschappen in deze tab om ze aan de route-CSV toe te voegen.')
        return
      }
      if (!eligibleNow()) throw Error('Originele opnames zijn verlopen.')
      const reviewedCsv = exportMixedStoreRouteCsv({
        plus, deka, route: plan, captured,
        checked: new Set(plan.lines.filter(line => done(line.key)).map(line => line.key)),
        extraVisitCostCents: appliedCostCents, strategy: mode,
      })
      const csv = appendUnpricedExtrasToMixedRouteCsv(reviewedCsv, saved.items)
      if (!eligibleNow()) throw Error('Bronopnames zijn intussen verlopen.')
      const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }))
      try {
        const link = document.createElement('a'); link.href = url
        link.download = 'supa-gekozen-winkelroute-met-ongeprijsde-extra-boodschappen.csv'
        document.body.append(link); try { link.click() } finally { link.remove() }
        setMessage('28-koloms CSV gedownload: gecontroleerde routebedragen en losse ongeprijsde extras; zonder bedragen voor extras.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch {
      setMessage('Kon de samengestelde route-CSV niet veilig maken. Herzie de bronnen en extra boodschappen.')
    }
  }

  async function downloadPrintHtml(includeExtras = false) {
    if (block || !eligibleNow()) {
      setMessage('Controleer je huidige originele winkelprijzen en extra bezoekkosten voordat je een afdruk bewaart.')
      return
    }
    try {
      let extras: import('./ownExtraGroceriesStorage.ts').Item[] | undefined
      if (includeExtras) {
        if (!privatePlanKey) throw Error('Geen huidig Planner-weekmandje beschikbaar.')
        const { readSavedExtrasForPlan } = await import('./ownExtraGroceriesStorage.ts')
        const saved = readSavedExtrasForPlan(privatePlanKey)
        if (!saved.available || !saved.items.length)
          throw Error('Bewaar eerst je eigen extra boodschappen in de Lijst-tab.')
        extras = saved.items
      }
      if (!eligibleNow()) throw Error('De oorspronkelijke bronopnames zijn verlopen.')
      const page = printMixedStoreRouteHtml({
        plus, deka, route: plan, captured,
        checked: new Set(plan.lines.filter(line => done(line.key)).map(line => line.key)),
        extraVisitCostCents: appliedCostCents, strategy: mode,
        extras,
      })
      if (!eligibleNow()) throw Error('Deze opnames zijn inmiddels verlopen.')
      const url = URL.createObjectURL(new Blob([page], { type: 'text/html;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = includeExtras
          ? 'supa-mijn-winkelroute-en-ongeprijsde-extras.html'
          : 'supa-mijn-winkelroute-prive.html'
        document.body.appendChild(link)
        try { link.click() } finally { link.remove() }
        setMessage('Afdrukbaar privéoverzicht opgeslagen. Open het HTML-bestand lokaal en kies Afdrukken in je browser.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Deze route kan nu niet veilig worden afgedrukt.')
    }
  }

  if (!chosenMixed) return <p role="alert">
    De aangepaste winkelroute kon niet veilig uit dezelfde complete fysieke mand worden
    berekend. Kies opnieuw een winkel per ingrediënt; er wordt geen nieuw bedrag getoond.
  </p>

  return <section className="offline-price-workbench__full-breakdown mixed-store-route"
    aria-label="Boodschappenroute met persoonlijke PLUS- en DekaMarkt-prijzen">
    <h4>Mijn boodschappenroute: goedkoopste artikelen of één winkel</h4>
    <p>Dezelfde fysieke Planner-vraag en uitsluitend jouw bevestigde producten,
      pakprijzen en hele verpakkingen. Bij dezelfde regelprijs kiest Supa PLUS.
      Er worden geen ontbrekende bronprijzen aangevuld.</p>
    <div className="offline-price-workbench__totals">
      <div><strong>PLUS volledig</strong><p>{money.format(mixed.plusWholeCents / 100)}</p></div>
      <div><strong>DekaMarkt volledig</strong><p>{money.format(mixed.dekaWholeCents / 100)}</p></div>
      <div><strong>Mijn gekozen route</strong><p>{money.format(plan.totalCents / 100)}</p></div>
    </div>
    <p role="status">Een route met de goedkoopste artikelen kan vóór extra bezoekkosten
      maximaal <strong>{money.format(mixed.additionalDifferenceCents / 100)}</strong>
      {' '}lager uitkomen dan het goedkoopste complete mandje bij één winkel.
      Dat is geen gegarandeerde besparing of live winkelprijs.</p>
    <div className="offline-price-workbench__actions">
      <label>Kies je winkelroute
        <select value={mode} onChange={event => {
          setMode(event.currentTarget.value as 'auto' | 'mixed' | 'single')
          setShowText(false); setMessage('')
        }}>
          <option value="auto">Automatisch, rekening houdend met opgegeven extra kosten</option>
          <option value="mixed">Goedkoopste artikelen, eventueel twee winkels</option>
          <option value="single">Alleen de goedkoopste complete winkel</option>
        </select>
      </label>
      <p><strong>Geselecteerd:</strong> {visitsBoth
        ? 'PLUS én DekaMarkt'
        : plan.lines[0]?.store ?? 'Geen winkel'} ·
        {' '}{money.format(plan.totalCents / 100)} aan winkelproducten.</p>
      {weekBudgetCents !== null && extraCount > 0 && <p role="status"
        className="mixed-store-route__budget">
        Je hebt ook {extraCount} eigen extra boodschappen zonder bronprijs. De werkelijke totale
        weekuitgaven en resterende budgetruimte zijn daarom <strong>onbekend</strong>.
        Vergelijk het weekbudget hieronder uitsluitend met de bekende geprijsde Planner-producten.
      </p>}
      {weekBudgetCents !== null && <p role="status" className="mixed-store-route__budget">
        {routeWithCostCents === null
          ? <>Je Planner-weekbudget is {money.format(weekBudgetCents / 100)}.
              Deze route bezoekt twee winkels; zonder jouw extra bezoekkosten is de
              totale budgetruimte <strong>onbekend</strong>.
              Alleen de gecontroleerde producten kosten {money.format(plan.totalCents / 100)}.</>
          : routeWithCostCents > weekBudgetCents
            ? <>Je bekende geprijsde Planner-route kost {money.format(routeWithCostCents / 100)}
                {' '}en ligt <strong>{money.format((routeWithCostCents - weekBudgetCents) / 100)}
                {' '}boven je Planner-weekbudget</strong>{visitsBoth ? ' inclusief jouw extra bezoekkosten' : ''}.</>
            : <>Je bekende geprijsde Planner-route kost {money.format(routeWithCostCents / 100)}
                {' '}en blijft <strong>{money.format((weekBudgetCents - routeWithCostCents) / 100)}
                {' '}voor deze bekende producten binnen je Planner-weekbudget</strong>{visitsBoth ? ' inclusief jouw extra bezoekkosten' : ''}.</>}
        {' '}Geen garantie op actuele kassaprijzen of andere niet-ingevulde kosten.
      </p>}
      {mode === 'auto' && chooseSingle && <p role="status">
        {selectedMixed.additionalDifferenceCents <= 0
          ? 'Met deze winkelkeuzes is de gecombineerde route niet goedkoper dan één compleet winkelmandje.'
          : 'Met jouw ingevoerde extra kosten is een compleet mandje bij één winkel minstens zo voordelig.'}
        {' '}Supa heeft daarom de boodschappenlijst op één winkel gezet. Kies expliciet de gemengde
        route als je toch beide winkels wilt bezoeken.</p>}
    </div>
    <details className="offline-price-workbench__full-breakdown mixed-store-route__preferences">
      <summary>Kies zelf een winkel per ingrediënt (optioneel)</summary>
      <p>De standaard is het goedkoopste hele-verpakkingenbedrag per ingrediënt.
        Je mag een andere winkel kiezen op basis van je eigen voorkeur;
        het bedrag blijft uitsluitend de door jou gecontroleerde bronprijs.</p>
      <button type="button" className="ghost-button" onClick={() => {
        setPreferred({}); setShowText(false)
      }}>Zet alle keuzes terug op goedkoopste artikelen</button>
      <div className="offline-price-workbench__dates mixed-store-route__choices">
        {mixed.lines.map(line => {
          const plusLine = plus.lines.find(item => item.id === line.id)
          const dekaLine = deka.lines.find(item => item.id === line.id)
          if (plusLine?.status !== 'matched' || dekaLine?.status !== 'matched') return null
          return <label key={line.id}>{line.ingredientLabel} · {line.amount} {line.unit}
            <select value={preferred[line.id] ?? ''} onChange={event => {
              const chosen = event.currentTarget.value as MixedStore | ''
              setPreferred(old => {
                const next = { ...old }
                if (chosen) next[line.id] = chosen
                else delete next[line.id]
                return next
              })
              setShowText(false)
              setMessage('Winkelvoorkeur aangepast. Supa herberekent de route uit de twee eerder gecontroleerde bronartikelen.')
            }}>
              <option value="">Kies automatisch het goedkoopste artikel</option>
              <option value="PLUS">PLUS · {money.format(plusLine.lineTotalCents / 100)} · {plusLine.productName}</option>
              <option value="DekaMarkt">DekaMarkt · {money.format(dekaLine.lineTotalCents / 100)} · {dekaLine.productName}</option>
            </select>
          </label>
        })}
      </div>
    </details>
    <MixedStoreUnitBreakdown plus={plus} deka={deka} route={plan} />
    {canEditSecondStop && <div className="offline-price-workbench__actions">
      <label>Extra kosten van de tweede stop (€)
        <input type="text" inputMode="decimal" value={extraVisitCost} maxLength={9}
          placeholder="Bijv. 2,50" onChange={event => {
            setExtraVisitCost(event.currentTarget.value); setMessage('')
          }} />
      </label>
      <p>Dit zijn jouw zelf opgegeven extra omrij-/parkeerkosten ten opzichte
        van één winkel. Zonder ingevuld bedrag is het netto voordeel onbekend.
        Het maximale theoretische voordeel vóór jouw winkelvoorkeuren is
        {' '}{money.format(mixed.additionalDifferenceCents / 100)}.</p>
      {costInvalid && <p role="alert">Voer een geldig bedrag in tussen € 0,00 en
        € 1.000,00, met hoogstens twee decimalen.</p>}
      {!costInvalid && netAdvantage !== null && <p role="status">
        Twee winkels zouden inclusief jouw extra kosten{' '}
        <strong>{money.format((selectedMixed.totalCents + extraCostCents!) / 100)}</strong>
        {' '}kosten. {netAdvantage > 0
          ? 'Dat is ' + money.format(netAdvantage / 100) + ' minder dan één complete winkel.'
          : netAdvantage === 0
            ? 'Dat is gelijk aan één complete winkel.'
            : 'Een complete winkel is ' + money.format(-netAdvantage / 100) + ' goedkoper.'}
      </p>}
    </div>}
    {!visitsBoth && <p>Je gekozen lijst vergt maar één winkelbezoek.
      Extra kosten voor een tweede stop worden niet meegerekend.</p>}
    <div role="status" className="mixed-store-route__progress-summary">
      <strong>{doneCount} van {plan.lines.length} ingrediënten afgevinkt</strong>
      <span>Nog op jouw gekozen boodschappenlijst: <strong>{
        money.format(remainingProductCents / 100)}</strong></span>
      <small>Alleen productbedragen uit je eigen prijsopnames. Vinkjes bewijzen geen betaling;
        extra winkelbezoekkosten zijn niet verdeeld over de artikelen.</small>
    </div>
    <div className="offline-price-workbench__actions">
      <label><input type="checkbox" checked={onlyOpen}
        onChange={event => setOnlyOpen(event.currentTarget.checked)} /> Alleen nog te kopen</label>
      {isSingleCheckedOnRoute && <button type="button" className="ghost-button"
        onClick={importSingleStoreChecks}>Neem vinkjes uit mijn aparte winkellijsten over</button>}
      {plannerPlan && plannerRecipes && plannerActiveDays && <button type="button"
        className="ghost-button" onClick={() => { void importPlannerChecks() }}>
        Neem ongeprijsde Planner-vinkjes over
      </button>}
      <button type="button" className="ghost-button" onClick={() => setChecked({})}>Wis vinkjes</button>
      <button type="button" className="ghost-button" onClick={download}>Download gekozen weergave (TXT)</button>
      {privatePlanKey && <button type="button" className="ghost-button"
        onClick={() => { void downloadRouteWithExtras() }}>
        Download gekozen winkelroute + bewaarde ongeprijsde extras (TXT)
      </button>}
      <button type="button" className="ghost-button" onClick={downloadRouteCsv}>
        Download volledige route met beide winkelprijzen (CSV)
      </button>
      {privatePlanKey && <button type="button" className="ghost-button"
        onClick={() => { void downloadRouteCsvWithExtras() }}>
        Download gecontroleerde route + ongeprijsde extras (CSV)
      </button>}
      <button type="button" className="ghost-button" onClick={() => { void downloadPrintHtml(false) }}>
        Bewaar / print volledige route (HTML)
      </button>
      {privatePlanKey && <button type="button" className="ghost-button"
        onClick={() => { void downloadPrintHtml(true) }}>
        Print gekozen route én bewaarde extra boodschappen (HTML)
      </button>}
      <button type="button" className="ghost-button" onClick={() => {
        if (block) { setMessage('Corrigeer eerst je extra kosten.'); return }
        if (!eligibleNow()) { setShowText(false); setMessage('Bronnen verlopen: opnieuw controleren.'); return }
        setShowText(value => !value)
      }}>{showText ? 'Verberg kopieerbare lijst' : 'Toon kopieerbare lijst'}</button>
    </div>
    <small>De gecombineerde route-TXT bevat alleen expliciet in deze tab bewaarde extra
      boodschappen van exact deze Planner-week. Extra kosten zijn onbekend en
      niet in de winkelvergelijking opgeteld.</small>
    <small>TXT en kopieerweergave volgen 'Alleen nog te kopen'. CSV en printbare
      HTML bewaren steeds de volledige gecontroleerde route inclusief vinkjes,
      originele SKU’s, pakprijzen en bronmomenten.</small>
    <div className="offline-price-workbench__dates mixed-store-route__shops">
      {stores.map(store => {
        const all = plan.lines.filter(item => item.store === store)
        const visible = all.filter(item => !onlyOpen || !done(item.key))
        return <section key={store}>
          <h4>{store} · {money.format(perStoreProgress[store].totalCents / 100)}</h4>
          <p><strong>{perStoreProgress[store].done} van {perStoreProgress[store].count}</strong>
            {' '}ingrediënten afgevinkt. Nog op de lijst bij deze winkel:{' '}
            <strong>{money.format(perStoreProgress[store].remainingCents / 100)}</strong>.</p>
          {all.length > 0 && <button type="button" className="ghost-button"
            onClick={() => {
              const allDone = all.every(line => done(line.key))
              if (!allDone && !window.confirm('Alle ' + all.length +
                ' artikelen voor ' + store + ' afvinken? Dit bewijst geen betaling.')) return
              setChecked(previous => {
                const next = { ...previous }
                for (const line of all) {
                  if (allDone) delete next[key(line.key)]
                  else next[key(line.key)] = true
                }
                return next
              })
              setMessage(allDone ? 'Vinkjes bij ' + store + ' gewist.' :
                'Artikelen bij ' + store + ' afgevinkt.')
            }}>
            {perStoreProgress[store].done === all.length
              ? 'Vinkjes bij ' + store + ' wissen'
              : 'Alle artikelen bij ' + store + ' afvinken'}
          </button>}
          {visible.length === 0
            ? <p>{all.length ? 'Alles bij deze winkel afgevinkt.' : 'Geen producten bij deze winkel nodig.'}</p>
            : <ul>{visible.map(item => <li key={item.key}
                ref={routeChoice?.lineKey === item.key ? selectedLineRef : undefined}
                className={routeChoice?.lineKey === item.key
                  ? 'mixed-store-route__chosen-from-products' : undefined}>
              <label>
              <input type="checkbox" checked={done(item.key)}
                onChange={event => {
                  const checkedNow = event.currentTarget.checked
                  setChecked(old => ({ ...old, [key(item.key)]: checkedNow }))
                }} />
              <strong>{item.ingredientLabel}</strong> · benodigd {item.amount} {item.unit}:
              {' '}{item.packs} × {item.productName} [{item.productId}]
              {' '}({item.packCount} × {item.packAmount} {item.packUnit}/pak)
              {' '}· {money.format(item.pricePerPackCents / 100)} per pak
              {' '}= {money.format(item.lineTotalCents / 100)}
            </label></li>)}</ul>}
        </section>
      })}
    </div>
    {privatePlanKey && <PrivateRouteExtraGroceries
      identity={privatePlanKey} onlyOpen={onlyOpen} onCount={setExtraCount} />}
    {showText && <label>Kopieer mijn private boodschappenroute
      <textarea readOnly rows={Math.min(18, plan.lines.length + 15)}
        spellCheck={false} value={printable} onFocus={event => {
          if (eligibleNow()) event.currentTarget.select()
          else { setShowText(false); setMessage('Deze bron is niet meer actueel.') }
        }} />
    </label>}
    <MixedTripBackupControls
      context={{ plus, deka, captured }}
      settings={{ mode, preferred, extraVisitCost }}
      plan={plan}
      checked={new Set(plan.lines.filter(line => done(line.key)).map(line => line.key))}
      eligibleNow={eligibleNow}
      onRestore={restored => {
        setMode(restored.mode)
        setPreferred(restored.preferred)
        setExtraVisitCost(restored.extraVisitCost)
        setChecked(Object.fromEntries(restored.checked.map(item => [key(item), true])))
        setShowText(false)
        setOnlyOpen(false)
        setMessage('Winkelvoorkeuren en afvinkingen teruggezet zonder prijsgoedkeuringen over te nemen.')
      }}
    />
    <p role="status" aria-live="polite">{message}</p>
    <small>Alleen volledige en persoonlijk gecontroleerde winkelopnames van maximaal
      zeven dagen oud met bronmomenten binnen 24 uur. Wijziging van een product
      of Planner-vraag vereist nieuwe goedkeuring. Eventuele extra kosten worden
      uitsluitend uit jouw eigen invoer berekend.</small>
  </section>
}
