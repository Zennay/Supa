import { euro as exactEuro } from '../../lib/money.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { OneStoreBasket, RecipeWithIngredients } from '../../domain/basket.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import type { MixedStoreShoppingPlan, MixedStore, MixedStoreLine } from './mixedStoreShoppingPlan.ts'
import { createMixedStoreShoppingPlan, formatMixedStoreShoppingPlan } from './mixedStoreShoppingPlan.ts'
import { MixedTripBackupControls } from './MixedTripBackupControls.tsx'
import { PrivateRouteExtraGroceries } from './PrivateRouteExtraGroceries.tsx'
import { MixedStoreUnitBreakdown } from './MixedStoreUnitBreakdown.tsx'
import { exportMixedStoreRouteCsv } from './mixedStoreRouteCsv.ts'
import { appendManualUnpricedNotesToMixedRouteCsv } from './mixedStoreWithExtrasCsv.ts'
import { printMixedStoreRouteHtml } from './mixedStorePrintHtml.ts'
import { validCustomWeekBudgetEuros } from '../planner/customWeekBudget.ts'
import { parsePrivateExtraVisitCostCents, type PrivateExtraVisitCostIntent } from './privateExtraVisitCost.ts'
import type { PrivateRouteChoice } from './privateReviewedBasketBridge.ts'
import type { UnpricedShoppingNote } from '../shopping-list/ManualShoppingNotes.tsx'
const stores: MixedStore[] = ['PLUS', 'DekaMarkt']

/** Renders only a reviewed, timely, same-demand comparison. Never loads
 * another retailer or turns a missing observed price into a cheaper option.
 * Download/copy still requires the parent source gate at click time.
 */
export function MixedStoreShoppingCard({
  mixed, single, plus, deka, captured, eligibleNow, weekBudget,
  plannerPlan, plannerRecipes, plannerActiveDays, privatePlanKey, isSingleCheckedOnRoute, routeChoice, routeCostIntent, manualNotes = [], onToggleManualNote,
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
  manualNotes?: readonly UnpricedShoppingNote[]
  onToggleManualNote?: (note: UnpricedShoppingNote) => void
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [extraCount, setExtraCount] = useState(0)
  const [showText, setShowText] = useState(false)
  const [combinedCopy, setCombinedCopy] = useState<{ fingerprint: string; text: string } | null>(null)
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
  const weekBudgetCents = validBudget === null ? null : BigInt(Math.round(validBudget * 100))
  // A two-stop route cannot assert budget headroom until its extra visit
  // costs are explicitly supplied. One-store routes need no second stop.
  const routeWithCostCents = visitsBoth
    ? extraCostCents === null ? null : BigInt(plan.totalCents) + BigInt(extraCostCents)
    : BigInt(plan.totalCents)
  const netAdvantage = extraCostCents === null ? null :
    BigInt(selectedMixed.additionalDifferenceCents) - BigInt(extraCostCents)
  const key = (id: string) => JSON.stringify([captured.PLUS, captured.DekaMarkt, id])
  const done = (id: string) => !!checked[key(id)]
  const progress = Object.fromEntries(plan.lines.map(line => [line.key, done(line.key)]))
  const doneCount = plan.lines.filter(line => progress[line.key]).length
  const perStoreProgress = Object.fromEntries(stores.map(store => {
    const lines = plan.lines.filter(line => line.store === store)
    const doneLines = lines.filter(line => progress[line.key])
    const totalCents = lines.reduce((sum, line) => sum + BigInt(line.lineTotalCents), 0n)
    const remainingCents = lines.filter(line => !progress[line.key])
      .reduce((sum, line) => sum + BigInt(line.lineTotalCents), 0n)
    return [store, { count: lines.length, done: doneLines.length, totalCents, remainingCents }]
  })) as Record<MixedStore, {
    count: number; done: number; totalCents: bigint; remainingCents: bigint
  }>
  const remainingProductCents = stores.reduce(
    (sum, store) => sum + perStoreProgress[store].remainingCents, 0n)
  const validManualNotes = manualNotes.filter(note => note &&
    ['Algemeen', 'PLUS', 'DekaMarkt'].includes(note.store) &&
    typeof note.label === 'string' && note.label.length > 0 &&
    note.label.length <= 140 && typeof note.done === 'boolean')
  const visitedStores = new Set(plan.lines.map(line => line.store))
  const offRouteManualNotes = validManualNotes.filter(note =>
    note.store !== 'Algemeen' && !visitedStores.has(note.store))
  const visibleManualNotes = onlyOpen ? validManualNotes.filter(note => !note.done) : validManualNotes
  const personalText = [
    'PERSOONLIJKE BOODSCHAPPEN — GEEN SKU, BRONMOMENT OF PRIJS',
    ...visibleManualNotes.map(note => (note.done ? '☑ ' : '☐ ') +
      '[' + note.store + '] ' +
      note.label.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim() +
      (note.store !== 'Algemeen' && !visitedStores.has(note.store)
        ? ' · BUITEN deze gekozen route · prijs onbekend'
        : ' · prijs onbekend')),
    'Deze eigen regels tellen niet mee voor productkosten, winkelwinnaar of besparing.',
  ].join('\n')
  const printable = formatMixedStoreShoppingPlan(plan, captured, progress, appliedCostCents, onlyOpen) +
    (visibleManualNotes.length ? '\n\n' + personalText : '')
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

  const copyFingerprint = JSON.stringify([privatePlanKey, printable, captured, mode, onlyOpen])
  const currentCopyFingerprint = useRef(copyFingerprint)
  currentCopyFingerprint.current = copyFingerprint
  useEffect(() => {
    const refresh = (event: Event) => {
      if ((event as CustomEvent<string>).detail === privatePlanKey) setCombinedCopy(null)
    }
    window.addEventListener('supa:private-week-extras-saved', refresh)
    return () => window.removeEventListener('supa:private-week-extras-saved', refresh)
  }, [privatePlanKey])
  async function combinedRouteText(): Promise<string> {
    if (!privatePlanKey || block || !eligibleNow())
      throw Error('Controleer eerst alle originele bronartikelen en eventuele extra bezoekkosten.')
    const { readSavedExtrasForPlan } = await import('./ownExtraGroceriesStorage.ts')
    const saved = readSavedExtrasForPlan(privatePlanKey)
    if (!saved.available)
      throw Error('De bewaarde extra boodschappen zijn niet leesbaar. Controleer je privégegevens in de Lijst.')
    if (!saved.items.length && !validManualNotes.length)
      throw Error('Voeg eerst eigen ongeprijsde boodschappen toe in de Lijst.')
    const visible = onlyOpen ? saved.items.filter(item => !item.done) : saved.items
    const clean = (value: string) => value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim()
    const complete = saved.items.length ? [printable, '',
      'EIGEN EXTRA BOODSCHAPPEN (' + saved.items.length + ' apart bewaard)',
      'Geen gekoppelde winkel, bronprijs, pakprijs of bijdrage aan bovenstaand prijsverschil.',
      ...visible.map(item => (item.done ? '☑ ' : '☐ ') + clean(item.name) +
        ' · ' + item.quantity + ' ' + (item.unit === 'piece' ? 'stuks' : item.unit) +
        ' · prijs onbekend'),
      'Bovenstaande bedragen omvatten uitsluitend het geprijsde Planner-weekmandje.',
    ].join('\n') : printable
    if (new TextEncoder().encode(complete).length > 128000 || !eligibleNow())
      throw Error('Bron of privélijst is gewijzigd of verlopen.')
    return complete
  }
  async function downloadRouteWithExtras() {
    try {
      const complete = await combinedRouteText()
      const url = URL.createObjectURL(new Blob([complete], { type: 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a'); link.href = url
        link.download = 'supa-winkelroute-plus-ongeprijsde-extra-boodschappen.txt'
        document.body.append(link); try { link.click() } finally { link.remove() }
        setMessage('Gecombineerde privéroute opgeslagen. De extras tellen niet mee in eurototalen.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'De gecombineerde privélijst is niet beschikbaar.')
    }
  }
  async function prepareCombinedCopy() {
    try {
      const original = copyFingerprint
      const text = await combinedRouteText()
      if (original !== currentCopyFingerprint.current || !eligibleNow())
        throw Error('De bron of gekozen route is gewijzigd. Open de complete lijst opnieuw.')
      setCombinedCopy({ fingerprint: original, text })
      setMessage('Je kunt jouw gekozen route met eigen ongeprijsde boodschappen hieronder selecteren en kopiëren.')
    } catch (error) {
      setCombinedCopy(null)
      setMessage(error instanceof Error ? error.message : 'Kopieerbare volledige route niet beschikbaar.')
    }
  }

  function downloadRouteCsv() {
    if (block || !eligibleNow()) {
      setMessage('Controleer eerst alle originele bronartikelen en de eventueel opgegeven extra kosten.')
      return
    }
    try {
      const csv = appendManualUnpricedNotesToMixedRouteCsv(exportMixedStoreRouteCsv({
        plus, deka, route: plan, captured,
        checked: new Set(plan.lines.filter(line => done(line.key)).map(line => line.key)),
        extraVisitCostCents: appliedCostCents, strategy: mode,
      }), validManualNotes, [...visitedStores])
      if (!eligibleNow()) throw Error('De bronopnames zijn inmiddels verlopen.')
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-mijn-gekozen-winkelroute-prive.csv'
        document.body.appendChild(link)
        try { link.click() } finally { link.remove() }
        setMessage('Je gekozen route is als lokale CSV bewaard; eigen ongeprijsde regels staan zonder winkelprijs onderaan.')
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
      if (!saved.available)
        throw Error('De bewaarde extra boodschappen zijn niet leesbaar.')
      if (!saved.items.length && !validManualNotes.length) {
        setMessage('Voeg eerst eigen ongeprijsde boodschappen toe in je Lijst.')
        return
      }
      if (!eligibleNow()) throw Error('Originele opnames zijn verlopen.')
      const reviewedCsv = exportMixedStoreRouteCsv({
        plus, deka, route: plan, captured,
        checked: new Set(plan.lines.filter(line => done(line.key)).map(line => line.key)),
        extraVisitCostCents: appliedCostCents, strategy: mode,
      })
      const withExtras = saved.items.length
        ? appendUnpricedExtrasToMixedRouteCsv(reviewedCsv, saved.items) : reviewedCsv
      const csv = appendManualUnpricedNotesToMixedRouteCsv(withExtras, validManualNotes, [...visitedStores])
      if (!eligibleNow()) throw Error('Bronopnames zijn intussen verlopen.')
      const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }))
      try {
        const link = document.createElement('a'); link.href = url
        link.download = 'supa-gekozen-winkelroute-met-ongeprijsde-extra-boodschappen.csv'
        document.body.append(link); try { link.click() } finally { link.remove() }
        setMessage('28-koloms route-CSV gedownload: originele prijsregels en aparte ongeprijsde eigen boodschappen zonder eurobedragen.')
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
        if (!saved.available)
          throw Error('Opgeslagen extra boodschappen zijn niet leesbaar.')
        if (!saved.items.length && !validManualNotes.length)
          throw Error('Voeg eerst eigen ongeprijsde boodschappen toe in de Lijst-tab.')
        extras = saved.items
      }
      if (!eligibleNow()) throw Error('De oorspronkelijke bronopnames zijn verlopen.')
      const page = printMixedStoreRouteHtml({
        plus, deka, route: plan, captured,
        checked: new Set(plan.lines.filter(line => done(line.key)).map(line => line.key)),
        extraVisitCostCents: appliedCostCents, strategy: mode,
        extras, manualNotes: validManualNotes,
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
      <div><strong>PLUS volledig</strong><p>{exactEuro.formatCents(mixed.plusWholeCents)}</p></div>
      <div><strong>DekaMarkt volledig</strong><p>{exactEuro.formatCents(mixed.dekaWholeCents)}</p></div>
      <div><strong>Mijn gekozen route</strong><p>{exactEuro.formatCents(plan.totalCents)}</p></div>
    </div>
    {offRouteManualNotes.length > 0 && <p role="status"
      className="mixed-store-route__budget">
      <strong>{offRouteManualNotes.length} eigen ongeprijsde {offRouteManualNotes.length === 1
        ? 'boodschap hoort' : 'boodschappen horen'} bij een winkel buiten jouw gekozen route.</strong>
      {' '}Supa voegt die winkel niet stilzwijgend als stop toe. Kies zelf een andere
      winkelroute of pas de winkelgroep aan in je persoonlijke Lijst.
    </p>}
    {validManualNotes.length > 0 && <p role="status" className="mixed-store-route__budget">
      Daarnaast staan {validManualNotes.length} eigen ongeprijsde boodschappen op deze route,
      waarvan {validManualNotes.filter(note => !note.done).length} open.
      <strong> De daadwerkelijke uitgaven zijn onbekend.</strong> Bovenstaande eurobedragen
      zijn alleen de gecontroleerde Planner-producten, nooit deze extra regels.
    </p>}
    <p role="status">Een route met de goedkoopste artikelen kan vóór extra bezoekkosten
      maximaal <strong>{exactEuro.formatCents(mixed.additionalDifferenceCents)}</strong>
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
        {' '}{exactEuro.formatCents(plan.totalCents)} aan winkelproducten.</p>
      {weekBudgetCents !== null && (extraCount > 0 || validManualNotes.length > 0) && <p role="status"
        className="mixed-store-route__budget">
        Je hebt ook {extraCount} extra boodschappen en {validManualNotes.length} eigen lijstregels zonder bronprijs. De werkelijke totale
        weekuitgaven en resterende budgetruimte zijn daarom <strong>onbekend</strong>.
        Vergelijk het weekbudget hieronder uitsluitend met de bekende geprijsde Planner-producten.
      </p>}
      {weekBudgetCents !== null && <p role="status" className="mixed-store-route__budget">
        {routeWithCostCents === null
          ? <>Je Planner-weekbudget is {exactEuro.formatCents(weekBudgetCents)}.
              Deze route bezoekt twee winkels; zonder jouw extra bezoekkosten is de
              totale budgetruimte <strong>onbekend</strong>.
              Alleen de gecontroleerde producten kosten {exactEuro.formatCents(plan.totalCents)}.</>
          : routeWithCostCents > weekBudgetCents
            ? <>Je bekende geprijsde Planner-route kost {exactEuro.formatCents(routeWithCostCents)}
                {' '}en ligt <strong>{exactEuro.formatCents((routeWithCostCents - weekBudgetCents))}
                {' '}boven je Planner-weekbudget</strong>{visitsBoth ? ' inclusief jouw extra bezoekkosten' : ''}.</>
            : <>Je bekende geprijsde Planner-route kost {exactEuro.formatCents(routeWithCostCents)}
                {' '}en blijft <strong>{exactEuro.formatCents((weekBudgetCents - routeWithCostCents))}
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
              <option value="PLUS">PLUS · {exactEuro.formatCents(plusLine.lineTotalCents)} · {plusLine.productName}</option>
              <option value="DekaMarkt">DekaMarkt · {exactEuro.formatCents(dekaLine.lineTotalCents)} · {dekaLine.productName}</option>
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
        {' '}{exactEuro.formatCents(mixed.additionalDifferenceCents)}.</p>
      {costInvalid && <p role="alert">Voer een geldig bedrag in tussen € 0,00 en
        € 1.000,00, met hoogstens twee decimalen.</p>}
      {!costInvalid && netAdvantage !== null && <p role="status">
        Twee winkels zouden inclusief jouw extra kosten{' '}
        <strong>{exactEuro.formatCents(BigInt(selectedMixed.totalCents) + BigInt(extraCostCents!))}</strong>
        {' '}kosten. {netAdvantage > 0n
          ? 'Dat is ' + exactEuro.formatCents(netAdvantage) + ' minder dan één complete winkel.'
          : netAdvantage === 0n
            ? 'Dat is gelijk aan één complete winkel.'
            : 'Een complete winkel is ' + exactEuro.formatCents(-netAdvantage) + ' goedkoper.'}
      </p>}
    </div>}
    {!visitsBoth && <p>Je gekozen lijst vergt maar één winkelbezoek.
      Extra kosten voor een tweede stop worden niet meegerekend.</p>}
    <div role="status" className="mixed-store-route__progress-summary">
      <strong>{doneCount} van {plan.lines.length} ingrediënten afgevinkt</strong>
      <span>Nog op jouw gekozen boodschappenlijst: <strong>{
        exactEuro.formatCents(remainingProductCents)}</strong></span>
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
      {privatePlanKey && <button type="button" className="ghost-button"
        onClick={() => { void prepareCombinedCopy() }}>
        Toon kopieerbare route + extra boodschappen
      </button>}
      <button type="button" className="ghost-button" onClick={download}>Download gekozen weergave (TXT)</button>
      {privatePlanKey && <button type="button" className="ghost-button"
        onClick={() => { void downloadRouteWithExtras() }}>
        Download gekozen winkelroute + bewaarde ongeprijsde extras (TXT)
      </button>}
      <button type="button" className="ghost-button" onClick={downloadRouteCsv}>
        Download route: bronprijzen + eigen ongeprijsde regels (CSV)
      </button>
      {privatePlanKey && <button type="button" className="ghost-button"
        onClick={() => { void downloadRouteCsvWithExtras() }}>
        Download route + alle eigen ongeprijsde boodschappen (CSV)
      </button>}
      <button type="button" className="ghost-button" onClick={() => { void downloadPrintHtml(false) }}>
        Bewaar / print route inclusief eigen ongeprijsde regels (HTML)
      </button>
      {privatePlanKey && <button type="button" className="ghost-button"
        onClick={() => { void downloadPrintHtml(true) }}>
        Print route met alle eigen ongeprijsde boodschappen (HTML)
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
      HTML bewaren de volledige gecontroleerde route inclusief vinkjes, originele
      SKU’s, pakprijzen en bronmomenten. Persoonlijke ongeprijsde herinneringen
      staan daarbij in een aparte sectie zonder gekozen bronproduct of eurobedrag.</small>
    <div className="offline-price-workbench__dates mixed-store-route__shops">
      {stores.map(store => {
        const all = plan.lines.filter(item => item.store === store)
        const visible = all.filter(item => !onlyOpen || !done(item.key))
        return <section key={store}>
          <h4>{store} · {exactEuro.formatCents(perStoreProgress[store].totalCents)}</h4>
          <p><strong>{perStoreProgress[store].done} van {perStoreProgress[store].count}</strong>
            {' '}ingrediënten afgevinkt. Nog op de lijst bij deze winkel:{' '}
            <strong>{exactEuro.formatCents(perStoreProgress[store].remainingCents)}</strong>.</p>
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
              {' '}· {exactEuro.formatCents(item.pricePerPackCents)} per pak
              {' '}= {exactEuro.formatCents(item.lineTotalCents)}
            </label></li>)}</ul>}
        </section>
      })}
    </div>
    {validManualNotes.length > 0 && <section className="mixed-store-route__manual"
      aria-label="Eigen ongeprijsde boodschappen in mijn winkelroute">
      <h4>Eigen boodschappen · nog zonder prijs</h4>
      <p>Alleen jouw persoonlijke lijst: {validManualNotes.filter(note => !note.done).length}
        {' '}van {validManualNotes.length} open. Vinkjes worden ook zichtbaar in je gewone Lijst;
        ze beïnvloeden geen SKU-keuze, eurobedrag of winkelwinnaar.</p>
      {(['PLUS', 'DekaMarkt', 'Algemeen'] as const).map(name => {
        const rows = visibleManualNotes.filter(note => note.store === name)
        return rows.length ? <div key={name}>
          <strong>{name === 'Algemeen' ? 'Algemeen · wijs zelf een winkel toe'
            : visitedStores.has(name) ? name : name + ' · buiten de gekozen route'}</strong>
          {onToggleManualNote && <button type="button" className="ghost-button" onClick={() => {
            const allDone = rows.every(note => note.done)
            if (!allDone && !window.confirm('Deze ' + rows.length + ' eigen ongeprijsde ' +
              name + '-artikelen afvinken? Dit bevestigt geen prijs of betaling.')) return
            rows.filter(note => note.done === allDone).forEach(note => onToggleManualNote(note))
            setMessage(allDone ? name + ': eigen vinkjes heropend.' :
              name + ': eigen ongeprijsde boodschappen afgevinkt.')
          }}>{rows.every(note => note.done)
            ? 'Heropen eigen ' + name + '-artikelen'
            : 'Vink zichtbare eigen ' + name + '-artikelen af'}</button>}
          <ul>{rows.map(note => <li key={note.id}><label>
            <input type="checkbox" checked={note.done} disabled={!onToggleManualNote}
              onChange={() => onToggleManualNote?.(note)} />
            {note.label} <small>· prijs onbekend · geen bron-SKU</small>
          </label></li>)}</ul>
        </div> : null
      })}
      {visibleManualNotes.length === 0 && <p>Alle persoonlijke lijstregels zijn afgevinkt.</p>}
    </section>}
    {privatePlanKey && <PrivateRouteExtraGroceries
      identity={privatePlanKey} onlyOpen={onlyOpen} onCount={setExtraCount} />}
    {combinedCopy?.fingerprint === copyFingerprint && <label>
      Kopieer mijn volledige privéroute inclusief ongeprijsde extra boodschappen
      <textarea readOnly spellCheck={false}
        rows={Math.min(20, Math.max(8, plan.lines.length + 8))}
        value={combinedCopy.text} onFocus={event => {
          if (!eligibleNow()) {
            setCombinedCopy(null)
            setMessage('Originele bronopnames zijn verlopen. Controleer de echte prijzen opnieuw.')
          } else event.currentTarget.select()
        }} />
    </label>}
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
