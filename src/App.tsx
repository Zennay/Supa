import { FigmaImage } from './components/FigmaImage'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PlannerView } from './features/planner/PlannerView'
import { WeekShareManualCopy } from './features/planner/WeekShareManualCopy'
import { PlannerPortableWeek } from './features/planner/PlannerPortableWeek.tsx'
import { currentWeekSharePreview, formatShareableWeek } from './features/planner/weekPlanShare'
import type { WeekSharePreview } from './features/planner/weekPlanShare'
// The private price workbench is sizeable and is not needed for Home, Recipes
// or the ordinary unpriced list. Keep it mounted after the first visit.
const BasketView = lazy(async () => {
  const module = await import('./features/basket/BasketView')
  return { default: module.BasketView }
})
import { ShoppingListView } from './features/shopping-list/ShoppingListView'
import { PrivateSourceShoppingList } from './features/shopping-list/PrivateSourceShoppingList.tsx'
import './features/shopping-list/listSourceFilePicker.css'
const PartialReviewedShoppingList = lazy(async () => {
  const module = await import('./features/shopping-list/PartialReviewedShoppingList.tsx')
  return { default: module.PartialReviewedShoppingList }
})
import { privatePhysicalShoppingTick } from './features/shopping-list/privatePhysicalShoppingTick.ts'
// Historical demo products remain separate. Only load the user's reviewed
// private source catalogue when they actually open the Products screen.
const PrivateReviewedProductCatalog = lazy(async () => {
  const module = await import('./features/products/PrivateReviewedProductCatalog.tsx')
  return { default: module.PrivateReviewedProductCatalog }
})
import { UnpricedPlannerChecklist } from './features/comparison/UnpricedPlannerChecklist.tsx'
const OwnExtraGroceries = lazy(async () => {
  const module = await import('./features/comparison/OwnExtraGroceries.tsx')
  return { default: module.OwnExtraGroceries }
})
import type { PrivateExtraVisitCostIntent } from './features/comparison/privateExtraVisitCost.ts'
import type { PrivateSourceFileHandoff } from './features/comparison/privateSourceFileHandoff.ts'
import { parsePrivateExtraVisitCostCents } from './features/comparison/privateExtraVisitCost.ts'
import { freshReviewedBaskets, type PrivateReviewedBaskets, type PrivateCaptureProgress, type PrivateReviewFocus, type OwnStore, type PrivateRouteChoice } from './features/comparison/privateReviewedBasketBridge.ts'
import { ObservationView } from './features/observation/ObservationView'
import { IdentityAvatar } from './components/IdentityAvatar.tsx'
import { HiFiHome, HiFiDemoList } from './features/home/HiFiHome'
import { readRecipeLibrary } from './features/recipes/recipeLibrary'
import { toPlannerRecipe } from './features/recipes/plannerRecipes'
import { curatedFigmaRecipes } from './features/recipes/curatedFigmaRecipes'
import { figmaAssets } from './features/home/figmaAssets'
import { buildOneStoreBasket } from './domain/basket'
import { compareFullBaskets } from './domain/basketComparison'
import {
  defaultPlannerPreferences,
  serializePlannerPreferences,
  type PlannerPreferences,
} from './domain/plannerPreferences'
import { unavailablePlannerRecipes, previewAvailablePlannerMeals } from './domain/unavailablePlannerRecipes.ts'
import { privatePhysicalPlanIdentity, privateWeekShareIdentity } from './domain/privatePhysicalPlanIdentity.ts'
import { saveReplacedPlannerRecipes, missingStoredOwnRecipeSelections } from './features/planner/saveReplacedPlannerRecipes.ts'
import { restorePlannerPreferencesWithCustomBudget } from './features/planner/customWeekBudget.ts'
import { canReplacePlannerRecord, persistPlannerRecord } from './features/planner/plannerStorageGuard.ts'
import {
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from './data/m2Fixture'
import {
  m3BaselineProducts,
  m3BaselineStore,
  m3CandidateProducts,
  m3CandidateStore,
} from './data/m3ComparisonFixture'

type Tab = 'home' | 'recipes' | 'products' | 'planner' | 'basket' | 'list' | 'observe'

const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: figmaAssets.imgVector5 },
  { id: 'planner', label: 'Planner', icon: figmaAssets.imgButton },
  { id: 'recipes', label: 'Recepten', icon: figmaAssets.imgButton1 },
  { id: 'products', label: 'Producten', icon: figmaAssets.imgButton2 },
  { id: 'list', label: 'Lijst', icon: figmaAssets.imgButton3 },
]

const originalProductNavIcons: Partial<Record<Tab, string>> = {
  home: figmaAssets.productsNavHome,
  planner: figmaAssets.productsNavPlanner,
  recipes: figmaAssets.productsNavRecipes,
  products: figmaAssets.productsNavProducts,
  list: figmaAssets.productsNavList,
}

const plannerStorageKey = 'supa:planner-preferences:v2'
const chosenProductsStorageKey = 'supa:chosen-products:v1'

/** Only this version of the owner's locally selected product identity list. */
function readChosenProducts(): { ids: string[]; raw: string | null; writable: boolean } {
  if (typeof window === 'undefined') return { ids: [], raw: null, writable: false }
  try {
    const raw = window.localStorage.getItem(chosenProductsStorageKey)
    if (raw === null) return { ids: [], raw: null, writable: true }
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ids: [], raw, writable: false }
    }
    const record = value as Record<string, unknown>
    const ids = record.ids
    if (record.schemaVersion !== 1 || Object.keys(record).some(key => key !== 'schemaVersion' && key !== 'ids') ||
        !Array.isArray(ids) || ids.length > 100 ||
        !ids.every(id => typeof id === 'string' &&
          /^(?:[a-z][a-z0-9-]{1,79}|historical:(?:plus|dekamarkt):[0-9]{1,18})$/.test(id)) ||
        new Set(ids).size !== ids.length) {
      return { ids: [], raw, writable: false }
    }
    return { ids: [...ids], raw, writable: true }
  } catch { return { ids: [], raw: null, writable: false } }
}
function availableRecipes() {
  try {
    if (typeof window === 'undefined') return [...m2Recipes, ...curatedFigmaRecipes]
    const own = readRecipeLibrary(window.localStorage).recipes.flatMap(recipe => { const projected = toPlannerRecipe(recipe); return projected ? [projected] : [] })
    return [...m2Recipes, ...curatedFigmaRecipes, ...own]
  } catch { return [...m2Recipes, ...curatedFigmaRecipes] }
}

type PersistenceWarning = 'unavailable' | 'protected' | null

function readPlannerPreferences(validRecipeIds = availableRecipes().map(recipe => recipe.id)): {
  preferences: PlannerPreferences
  warning: PersistenceWarning
  raw: string | null
} {
  const fallback = defaultPlannerPreferences(m2InitialPlan)
  if (typeof window === 'undefined') {
    return { preferences: fallback, warning: null, raw: null }
  }
  try {
    const raw = window.localStorage.getItem(plannerStorageKey)
    const restored = restorePlannerPreferencesWithCustomBudget(raw, m2InitialPlan, validRecipeIds)
    const missing = missingStoredOwnRecipeSelections(raw, m2InitialPlan, validRecipeIds)
    return {
      // Missing OWN recipe IDs remain a read-only, in-memory repair intent.
      // The actual week uses its existing safe temporary built-in fallback
      // and only a deliberate user action can update the protected v2 bytes.
      preferences: Object.keys(missing).length
        ? { ...restored, recipeByDay: { ...restored.recipeByDay, ...missing } }
        : restored,
      warning: canReplacePlannerRecord(raw, m2InitialPlan.map((meal) => meal.day), validRecipeIds)
        ? null : 'protected',
      raw,
    }
  } catch {
    return { preferences: fallback, warning: 'unavailable', raw: null }
  }
}

export function App({ initialTab = 'home' }: { initialTab?: Tab } = {}) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [visitedBasket, setVisitedBasket] = useState(initialTab === 'basket')
  const [visitedList, setVisitedList] = useState(initialTab === 'list')
  const [mixedRouteOpenSignal, setMixedRouteOpenSignal] = useState(0)
  const [mixedCostIntent, setMixedCostIntent] = useState<PrivateExtraVisitCostIntent | null>(null)
  const [privateRouteChoice, setPrivateRouteChoice] = useState<PrivateRouteChoice | null>(null)
  const [ownPriceImportSignal, setOwnPriceImportSignal] = useState(0)
  const [incomingPriceFiles, setIncomingPriceFiles] = useState<PrivateSourceFileHandoff | null>(null)
  const [listSourceFileWarning, setListSourceFileWarning] = useState('')
  const nextPriceFileSerial = useRef(0)
  const [privateReviewed, setPrivateReviewed] = useState<PrivateReviewedBaskets | null>(null)
  const [privateCaptureProgress, setPrivateCaptureProgress] = useState<PrivateCaptureProgress | null>(null)
  const [privateReviewFocus, setPrivateReviewFocus] = useState<PrivateReviewFocus | null>(null)
  // Only transient shopping ticks. Never persist prices or review approvals.
  // Keep across a temporary unpriced edit so a price-only correction preserves
  // the physical items already ticked; different SKUs or quantities use new keys.
  const [privateShoppingTicks, setPrivateShoppingTicks] = useState<Record<string, boolean>>({})
  const [sourceNowMs, setSourceNowMs] = useState(() => Date.now())
  const [preferredOwnStore, setPreferredOwnStore] = useState<OwnStore>('PLUS')
  const onReviewedBaskets = useCallback((next: PrivateReviewedBaskets | null) => {
    setSourceNowMs(Date.now())
    // The first actual owned store wins over the initial PLUS placeholder.
    // Once a store is chosen, adding the second receipt must not silently
    // switch the active Planner budget to the default store.
    if (next) setPreferredOwnStore(current => next.stores[current] ? current
      : next.stores.PLUS ? 'PLUS' : next.stores.DekaMarkt ? 'DekaMarkt' : current)
    setPrivateReviewed(previous => JSON.stringify(previous) === JSON.stringify(next)
      ? previous : next)
  }, [])
  const onCaptureProgress = useCallback((next: PrivateCaptureProgress | null) => {
    setPrivateCaptureProgress(previous => JSON.stringify(previous) === JSON.stringify(next)
      ? previous : next)
  }, [])
  // A sleeping tab cannot keep displaying a once-valid private price as current.
  // Re-check expiration while visible and immediately on returning from sleep;
  // do not persist observations, trigger network work, or invent fresh timestamps.
  useEffect(() => {
    if (!privateReviewed) return
    const refreshAge = () => setSourceNowMs(Date.now())
    const refreshIfVisible = () => {
      if (document.visibilityState !== 'hidden') refreshAge()
    }
    window.addEventListener('focus', refreshAge)
    document.addEventListener('visibilitychange', refreshIfVisible)
    const timer = window.setInterval(refreshIfVisible, 60_000)
    return () => {
      window.removeEventListener('focus', refreshAge)
      document.removeEventListener('visibilitychange', refreshIfVisible)
      window.clearInterval(timer)
    }
  }, [privateReviewed])
  const [initialProductSelection] = useState(readChosenProducts)
  const [designProductIds, setDesignProductIds] = useState<string[]>(() => initialProductSelection.ids)
  const [savedProductRaw, setSavedProductRaw] = useState(initialProductSelection.raw)
  const [productSelectionTouched, setProductSelectionTouched] = useState(false)
  const [productSelectionWarning, setProductSelectionWarning] = useState<'protected' | 'unavailable' | null>(
    () => initialProductSelection.writable ? null : (typeof window === 'undefined' ? null : 'protected'),
  )
  const isHiFiView = tab === 'home' || tab === 'recipes' || tab === 'products'
  const navigate = (next: Tab) => {
    if (next === 'basket') setVisitedBasket(true)
    if (next === 'list') setVisitedList(true)
    setTab(next); window.scrollTo?.(0, 0)
  }
  const openOwnPriceImport = () => {
    navigate('basket')
    setOwnPriceImportSignal(value => value + 1)
  }
  // Directly reveal the existing local source upload controls, not the
  // unrelated historical demonstration basket above them.
  useEffect(() => {
    if (tab !== 'basket' || ownPriceImportSignal === 0) return
    const frame = window.requestAnimationFrame(() =>
      document.getElementById('supa-own-price-import')?.scrollIntoView({
        block: 'start', behavior: 'smooth',
      }))
    return () => window.cancelAnimationFrame(frame)
  }, [tab, ownPriceImportSignal])
  const toggleDesignProduct = (id: string) => {
    setDesignProductIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
    setProductSelectionTouched(true)
  }
  useEffect(() => {
    if (!productSelectionTouched || typeof window === 'undefined') return
    if (!initialProductSelection.writable) {
      setProductSelectionWarning('protected')
      return
    }
    try {
      const actual = window.localStorage.getItem(chosenProductsStorageKey)
      // Never clobber unknown/future versions, or selections saved in another tab.
      if (actual !== savedProductRaw) {
        setProductSelectionWarning('protected')
        return
      }
      const next = JSON.stringify({ schemaVersion: 1, ids: designProductIds })
      if (actual !== next) window.localStorage.setItem(chosenProductsStorageKey, next)
      setSavedProductRaw(next)
      setProductSelectionWarning(null)
    } catch { setProductSelectionWarning('unavailable') }
  }, [designProductIds, productSelectionTouched, savedProductRaw])
  const [recipes, setRecipes] = useState(availableRecipes)
  const validRecipeIds = recipes.map(recipe => recipe.id)
  useEffect(() => {
    const refresh = () => setRecipes(availableRecipes())
    window.addEventListener('supa-recipes-changed', refresh)
    window.addEventListener('storage', refresh)
    return () => { window.removeEventListener('supa-recipes-changed', refresh); window.removeEventListener('storage', refresh) }
  }, [])
  const [initialLoad] = useState(() => readPlannerPreferences(validRecipeIds))
  const [preferences, setPreferences] = useState(() => initialLoad.preferences)
  const [persistenceWarning, setPersistenceWarning] = useState<PersistenceWarning>(initialLoad.warning)
  const [lastStoredRaw, setLastStoredRaw] = useState(initialLoad.raw)
  const [planRepairMessage, setPlanRepairMessage] = useState('')
  const [manualWeekCopy, setManualWeekCopy] = useState<WeekSharePreview | null>(null)
  const [includeWeekBudget, setIncludeWeekBudget] = useState(false)
  const [includeWeekDetails, setIncludeWeekDetails] = useState(false)
  const [weekCopyMessage, setWeekCopyMessage] = useState('')
  // RecipeLibrary dispatches an explicit local intent after the user chooses
  // one Planner day. Re-read the device-owned recipe at admission time: stale,
  // deleted, unreviewed or malformed ingredients must never enter the budget.
  useEffect(() => {
    const chooseOwnRecipe = (event: Event) => {
      const detail: unknown = (event as CustomEvent<unknown>).detail
      if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
        event.preventDefault()
        return
      }
      const { recipeId, day, destination } = detail as {
        recipeId?: unknown; day?: unknown; destination?: unknown
      }
      if (typeof recipeId !== 'string' || typeof day !== 'string' ||
          !m2InitialPlan.some(meal => meal.day === day)) {
        event.preventDefault()
        return
      }
      try {
        const library = readRecipeLibrary(window.localStorage)
        if (library.error) {
          event.preventDefault()
          return
        }
        const recipe = library.recipes.find(item => item.id === recipeId)
        if (!recipe || !toPlannerRecipe(recipe) ||
            !recipes.some(item => item.id === recipeId)) {
          event.preventDefault()
          return
        }
        setPreferences(current => ({
          ...current,
          activeDays: current.activeDays.includes(day) ? current.activeDays :
            [...current.activeDays, day],
          recipeByDay: { ...current.recipeByDay, [day]: recipeId },
        }))
        // Explicit recipe-to-price navigation reuses the existing local
        // source-import flow. Re-keying the plan invalidates any old retailer
        // matching; no sample or stale price is carried to the new recipe.
        if (destination === 'basket') {
          navigate('basket')
          setOwnPriceImportSignal(value => value + 1)
        } else if (destination === 'list') {
          // The existing list renders the newly selected physical Planner
          // demand even without a usable price source (explicitly unpriced).
          navigate('list')
        } else {
          navigate('planner')
        }
      } catch {
        // Never switch planning or use example prices after storage failure.
        event.preventDefault()
      }
    }
    window.addEventListener('supa-plan-own-recipe', chooseOwnRecipe)
    return () => window.removeEventListener('supa-plan-own-recipe', chooseOwnRecipe)
  }, [recipes])

  const { budget, activeDays, recipeByDay } = preferences

  // A recipe edited or removed in another tab may no longer belong to the
  // approved physical library. Render a safe built-in recipe for its own day
  // immediately; never silently persist that fallback or carry forward the
  // old source-price comparison. A deliberate user action can repair it.
  const unavailableSelections = useMemo(
    () => unavailablePlannerRecipes(preferences, m2InitialPlan, validRecipeIds),
    [preferences, recipes],
  )
  const plannedMeals = useMemo(
    () => previewAvailablePlannerMeals(m2InitialPlan, unavailableSelections, recipeByDay),
    [recipeByDay, unavailableSelections],
  )
  function acceptMissingRecipeReplacements() {
    const remaining = unavailablePlannerRecipes(preferences, m2InitialPlan, recipes.map(recipe => recipe.id))
    if (!remaining.length) return
    // A corrupt/unreadable recipe library can masquerade as a deleted
    // private recipe. Never offer an irreversible replacement of its saved
    // Planner references while that underlying library cannot be read.
    try {
      if (readRecipeLibrary(window.localStorage).error) {
        setPlanRepairMessage('Je eigen receptbibliotheek is niet leesbaar. De oorspronkelijke weekkeuzes blijven bewaard. Herstel eerst de bibliotheek.')
        return
      }
    } catch {
      setPlanRepairMessage('Je eigen recepten zijn tijdelijk niet leesbaar. De eerdere Planner-keuzes blijven bewaard.')
      return
    }
    const repaired: PlannerPreferences = {
      ...preferences,
      recipeByDay: {
        ...preferences.recipeByDay,
        ...Object.fromEntries(remaining.map(item => [item.day, item.fallbackRecipeId])),
      },
    }
    // An orphaned recipe ID makes the ordinary protected-storage guard refuse
    // to overwrite the old record. This narrowly scoped, explicit user action
    // is the only permitted recovery; all other records and cross-tab changes
    // stay protected. Never drop existing preferences on a failed save.
    const result = saveReplacedPlannerRecipes({
      read: () => window.localStorage.getItem(plannerStorageKey),
      write: raw => window.localStorage.setItem(plannerStorageKey, raw),
      expectedRaw: lastStoredRaw,
      current: repaired,
      replacements: remaining,
      validDays: m2InitialPlan.map(meal => meal.day),
      validRecipeIds: recipes.map(recipe => recipe.id),
    })
    if (result.status !== 'saved') {
      setPersistenceWarning(result.status)
      setPlanRepairMessage(result.status === 'protected'
        ? 'Je eerdere weekmenu is in een ander tabblad gewijzigd of bevat een onbekend formaat. Niets is overschreven.'
        : 'Browseropslag is niet beschikbaar. Je eerdere weekmenu blijft bewaard.')
      return
    }
    setLastStoredRaw(result.raw)
    setPreferences(repaired)
    setPersistenceWarning(null)
    setPlanRepairMessage('')
  }

  // Preserve still-current, user-reviewed PLUS/Deka captures when somebody
  // merely adds an unrelated recipe or edits an inactive day. Only changing
  // the ACTUAL selected physical week can invalidate these private receipts.
  const privatePlanKey = privatePhysicalPlanIdentity(plannedMeals, recipes, activeDays)
  // Planner and Lijst share the exact same real-source File handoff. Files
  // stay in this tab until the canonical Vergelijk importer consumes them.
  // No alternate CSV parser or implicit retailer approval is introduced.
  const handoffOwnPriceFiles = (files: File[]) => {
    if (!files.length) return
    if (files.length > 2 || files.some(file => !file.size || file.size > 256_000)) {
      setListSourceFileWarning('Kies maximaal twee gevulde eigen bronbestanden van maximaal 256 kB per bestand.')
      return
    }
    setListSourceFileWarning('')
    nextPriceFileSerial.current += 1
    setIncomingPriceFiles({
      serial: nextPriceFileSerial.current, planKey: privatePlanKey, files,
    })
    openOwnPriceImport()
  }
  const livePrivateReviewed = freshReviewedBaskets(privateReviewed, privatePlanKey, sourceNowMs)
  const preferredPrivateBasket = livePrivateReviewed?.stores[preferredOwnStore] ??
    livePrivateReviewed?.stores.PLUS ?? livePrivateReviewed?.stores.DekaMarkt


  // Bind prepared copy to the exact user-visible plan state. Clearing it in
  // an effect alone happens after render and briefly exposes stale personal text.
  const shareSourceKey = JSON.stringify([
    privateWeekShareIdentity(plannedMeals, recipes, activeDays, includeWeekDetails),
    budget, includeWeekBudget, includeWeekDetails,
  ])
  const currentManualCopy = currentWeekSharePreview(manualWeekCopy, shareSourceKey)

  const basket = useMemo(
    () =>
      buildOneStoreBasket({
        store: m2Store,
        plan: plannedMeals,
        recipes,
        activeDays,
        products: m2Products,
      }),
    [activeDays, plannedMeals, recipes],
  )

  const comparisonBaseline = useMemo(
    () =>
      buildOneStoreBasket({
        store: m3BaselineStore,
        plan: plannedMeals,
        recipes,
        activeDays,
        products: m3BaselineProducts,
      }),
    [activeDays, plannedMeals, recipes],
  )

  const comparisonCandidate = useMemo(
    () =>
      buildOneStoreBasket({
        store: m3CandidateStore,
        plan: plannedMeals,
        recipes,
        activeDays,
        products: m3CandidateProducts,
      }),
    [activeDays, plannedMeals, recipes],
  )

  const basketComparison = useMemo(
    () =>
      compareFullBaskets({
        baseline: comparisonBaseline,
        candidate: comparisonCandidate,
      }),
    [comparisonBaseline, comparisonCandidate],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Never overwrite unknown/future or unreadable preference bytes on initial
    // mount. An explicit planner edit can retry when storage becomes available.
    if (initialLoad.warning && preferences === initialLoad.preferences) return

    const result = persistPlannerRecord({
      read: () => window.localStorage.getItem(plannerStorageKey),
      write: (raw) => window.localStorage.setItem(plannerStorageKey, raw),
      expectedRaw: lastStoredRaw,
      nextRaw: serializePlannerPreferences(preferences),
      validDays: m2InitialPlan.map((meal) => meal.day),
      validRecipeIds,
    })
    if (result.status === 'saved') {
      setLastStoredRaw(result.raw)
      setPersistenceWarning(null)
    } else {
      setPersistenceWarning(result.status)
    }
  }, [preferences])

  useEffect(() => {
    // The export belongs to one exact plan snapshot; don't keep a stale draft
    // visible after the user changes the plan or budget.
    setManualWeekCopy(null)
    setWeekCopyMessage('')
  }, [preferences])

  const prepareWeekPlanCopy = () => {
    try {
      setManualWeekCopy({
        sourceKey: shareSourceKey,
        text: formatShareableWeek({
          plannedMeals,
          activeDays,
          recipes,
          budget,
          includeBudget: includeWeekBudget,
          includeDetails: includeWeekDetails,
        }),
      })
      setWeekCopyMessage('Selecteer en kopieer de tekst hieronder')
    } catch {
      setManualWeekCopy(null)
      setWeekCopyMessage('Weekmenu niet beschikbaar')
    }
  }

  const toggleDay = (day: string) => {
    setPreferences((current) => ({
      ...current,
      activeDays: current.activeDays.includes(day)
        ? current.activeDays.filter((candidate) => candidate !== day)
        : [...current.activeDays, day],
    }))
  }

  const changeRecipe = (day: string, recipeId: string) => {
    setPreferences((current) => ({
      ...current,
      recipeByDay: {
        ...current.recipeByDay,
        [day]: recipeId,
      },
    }))
  }

  const resetPlan = () => {
    setPreferences(defaultPlannerPreferences(m2InitialPlan))
  }

  return (
    <main className={`app-shell${isHiFiView ? ' hifi-shell' : ''}${tab === 'planner' || tab === 'list' ? ' hifi-working-shell' : ''}`}>
      {!isHiFiView && <header className="topbar">
        <div>
          <span className="brand-mark">S</span>
          <strong>SUPA</strong>
        </div>
        <IdentityAvatar />
      </header>}

      <div className="content">
        {(['planner', 'list', 'basket', 'products'] as const).some(view => view === tab) &&
          unavailableSelections.length > 0 && (
          <section className="attention-card" role="status" aria-live="polite">
            <strong>{unavailableSelections.length} receptkeuze(s) niet meer beschikbaar</strong>
            <p>
              Een eigen recept is verwijderd of heeft nog onveilige hoeveelheden.
              Het weekmenu toont tijdelijk het oorspronkelijke standaardrecept voor
              {unavailableSelections.length === 1 ? ' deze dag' : ' deze dagen'}:
              {' '}{unavailableSelections.map(item => item.day).join(', ')}.
              Je eerdere keuze is niet stilzwijgend opgeslagen of vervangen.
              Alle oude productmatches en eigen winkelprijzen voor een ander
              weekmenu blijven buiten de huidige prijsberekening.
            </p>
            <div className="week-share-actions">
              <button type="button" onClick={acceptMissingRecipeReplacements}>
                Bewaar deze standaardrecepten in mijn weekmenu
              </button>
              {tab !== 'planner' && <button type="button" className="ghost-button"
                onClick={() => navigate('planner')}>
                Bekijk de aangepaste week in Planner
              </button>}
            </div>
            {planRepairMessage && <p role="alert">{planRepairMessage}</p>}
          </section>
        )}
        {tab === 'products' && <Suspense fallback={<p role="status">Eigen bronproducten openen…</p>}>
          <PrivateReviewedProductCatalog reviewed={livePrivateReviewed} budget={budget}
            checked={privateShoppingTicks}
            onToggleChecked={(shop, selected) => {
              // No checkout progress can be created from expired or replaced
              // source products. Existing local checkmarks remain untouched.
              const current = freshReviewedBaskets(livePrivateReviewed, privatePlanKey, Date.now())
              const capture = current?.stores[shop]
              if (!capture || !capture.basket.lines.includes(selected)) return
              const key = privatePhysicalShoppingTick(privatePlanKey, shop, capture.basket.store.id, selected)
              setPrivateShoppingTicks(before => ({ ...before, [key]: !before[key] }))
            }}
            onOpenComparison={openOwnPriceImport}
            onChooseRouteLine={intent => {
              const serial = mixedRouteOpenSignal + 1
              setMixedCostIntent(null)
              setPrivateRouteChoice({ ...intent, serial })
              setMixedRouteOpenSignal(serial)
              navigate('list')
            }}
            onOpenMixedRoute={() => { setMixedCostIntent(null); setPrivateRouteChoice(null); setMixedRouteOpenSignal(value => value + 1); navigate('list') }}
            onOpenList={(store) => {
              if (store) setPreferredOwnStore(store)
              navigate('list')
            }} />
        </Suspense>}
        {(tab === 'home' || tab === 'recipes') && <HiFiHome view={tab}
          onNavigate={navigate} activeDays={activeDays}
          addedProducts={designProductIds} onToggleProduct={toggleDesignProduct} />}
        {tab === 'products' && <details className="supa-product-archive">
          <summary>Oude ontwerpvoorbeelden en historische bronkaarten tonen (geen actuele prijzen)</summary>
          <p>Alleen de persoonlijk bevestigde bronartikelen hierboven tellen mee in
            de prijsvergelijking, budgetten en winkelroute. Deze voorbeelden zijn
            geen supermarktvoorraad of actuele aanbiedingen.</p>
          <HiFiHome view="products" onNavigate={navigate} activeDays={activeDays}
            addedProducts={designProductIds} onToggleProduct={toggleDesignProduct} />
        </details>}
        {!isHiFiView && <nav className="hifi-utilities" aria-label="Vergelijken en meten"><button onClick={() => navigate('basket')}>Mand</button><button onClick={() => navigate('observe')}>Meten</button></nav>}

        {productSelectionWarning && (tab === 'list' || tab === 'products') && (
          <p role="status" className="disclaimer">
            {productSelectionWarning === 'protected'
              ? 'De productkeuzes zijn tijdelijk; bewaarde gegevens van een andere versie of tab blijven behouden.'
              : 'De productkeuzes zijn tijdelijk; de browser heeft opslaan geweigerd.'}
          </p>
        )}
        {persistenceWarning && (
          <p role="alert" className="disclaimer" aria-live="assertive">
            {persistenceWarning === 'protected'
              ? 'Je weekbudget en maaltijdkeuzes zijn tijdelijk en niet opgeslagen. Eerdere opgeslagen gegevens blijven bewaard.'
              : 'Je weekbudget en maaltijdkeuzes zijn tijdelijk en niet opgeslagen omdat browseropslag niet beschikbaar is.'}
          </p>
        )}
        {tab === 'planner' && (
          <PlannerView
            budget={budget}
            activeDays={activeDays}
            plannedMeals={plannedMeals}
            recipes={recipes}
            ownReviewed={livePrivateReviewed}
            captureProgress={privateCaptureProgress?.planKey === privatePlanKey
              ? privateCaptureProgress : null}
            preferredOwnStore={preferredOwnStore}
            onOpenShoppingList={() => navigate('list')}
            onOpenRecipes={() => navigate('recipes')}
            onOpenMixedRoute={rawCost => {
              const serial = mixedRouteOpenSignal + 1
              const fresh = freshReviewedBaskets(livePrivateReviewed, privatePlanKey, Date.now())
              const plus = fresh?.stores.PLUS
              const deka = fresh?.stores.DekaMarkt
              setMixedCostIntent(rawCost !== undefined &&
                parsePrivateExtraVisitCostCents(rawCost) !== null && plus && deka ? {
                  serial, planKey: fresh!.planKey,
                  observedAt: { PLUS: plus.observedAt, DekaMarkt: deka.observedAt },
                  raw: rawCost,
                } : null)
              setPrivateRouteChoice(null)
              setMixedRouteOpenSignal(serial)
              navigate('list')
            }}
            onChooseRouteLine={intent => {
              const serial = mixedRouteOpenSignal + 1
              setMixedCostIntent(null)
              setPrivateRouteChoice({ ...intent, serial })
              setMixedRouteOpenSignal(serial)
              navigate('list')
            }}
            basketTotalCents={preferredPrivateBasket?.basket.totalCents ?? null}
            basketUnresolvedLineCount={preferredPrivateBasket?.basket.unresolvedLineCount ?? 0}
            ownSource={preferredPrivateBasket ? {
              store: preferredPrivateBasket.basket.store.name,
              observedAt: preferredPrivateBasket.observedAt,
            } : undefined}
            ownSourceChoices={livePrivateReviewed
              ? (['PLUS', 'DekaMarkt'] as const).flatMap(store => {
                  const capture = livePrivateReviewed.stores[store]
                  return capture ? [{ store, observedAt: capture.observedAt }] : []
                }) : []}
            onOwnSourceChange={(store) => {
              if (store === 'PLUS' || store === 'DekaMarkt') setPreferredOwnStore(store)
            }}
            onOpenComparison={openOwnPriceImport}
            onImportSourceFiles={handoffOwnPriceFiles}
            onReviewIngredient={(store, ingredientId) => {
              setPrivateReviewFocus(previous => ({
                planKey: privatePlanKey, store, ingredientId,
                serial: (previous?.serial ?? 0) + 1,
              }))
              navigate('basket')
            }}
            onBudgetChange={(nextBudget) =>
              setPreferences((current) => ({
                ...current,
                budget: nextBudget,
              }))
            }
            onToggleDay={toggleDay}
            onRecipeChange={changeRecipe}
            onReset={resetPlan}
          />
        )}
        {tab === 'planner' && <PlannerPortableWeek
          preferences={preferences}
          days={m2InitialPlan.map(meal => meal.day)}
          recipeIds={recipes.map(recipe => recipe.id)}
          recipeNames={Object.fromEntries(recipes.map(recipe => [recipe.id, recipe.title]))}
          storageProtected={persistenceWarning !== null}
          onRestore={next => {
            setPreferences(next)
            setManualWeekCopy(null)
            setWeekCopyMessage('Weekplanning hersteld; controleer de nieuwe ingrediënten en prijsbronnen.')
          }}
        />}
        {tab === 'planner' && (
          <section className="week-share-panel" aria-label="Weekmenu delen">
            <div className="week-share-actions">
              <span>Deel je geplande maaltijden, zonder winkelprijzen.</span>
              <button type="button" className="ghost-button" onClick={prepareWeekPlanCopy}>
                Toon kopieertekst
              </button>
            </div>
            <label className="week-share-privacy">
              <input
                type="checkbox"
                checked={includeWeekBudget}
                onChange={(event) => {
                  setIncludeWeekBudget(event.target.checked)
                  setManualWeekCopy(null)
                  setWeekCopyMessage('')
                }}
              />
              Mijn weekbudget ook opnemen (optioneel)
            </label>
            <label className="week-share-privacy">
              <input
                type="checkbox"
                checked={includeWeekDetails}
                onChange={(event) => {
                  setIncludeWeekDetails(event.target.checked)
                  setManualWeekCopy(null)
                  setWeekCopyMessage('')
                }}
              />
              Bereidingstijd en porties opnemen
            </label>
            <p role="status" aria-live="polite">{weekCopyMessage}</p>
            {currentManualCopy !== null && (
              <WeekShareManualCopy
                text={currentManualCopy}
                rows={Math.min(activeDays.length + 6, 14)}
              />
            )}
          </section>
        )}
        {visitedBasket && (
          <div hidden={tab !== 'basket'} aria-hidden={tab !== 'basket'}>
          <Suspense fallback={<section className="screen" role="status" aria-live="polite">
            Vergelijker en persoonlijke prijsinvoer worden geopend…
          </section>}>
          <BasketView
            onPrivateImportReady={() => {
              // On the FIRST lazy mount the ordinary RAF navigation effect
              // may fire before the price import node exists. The mount
              // callback runs after the workbench DOM is present.
              if (tab === 'basket' && ownPriceImportSignal > 0) {
                document.getElementById('supa-own-price-import')?.scrollIntoView({
                  block: 'start', behavior: 'smooth',
                })
              }
            }}
            basket={basket}
            comparison={basketComparison}
            comparisonBaseline={comparisonBaseline}
            comparisonCandidate={comparisonCandidate}
            manualPlan={plannedMeals}
            manualRecipes={recipes}
            manualActiveDays={activeDays}
            privatePlanKey={privatePlanKey}
            incomingSources={incomingPriceFiles}
            onSourceFilesConsumed={serial => setIncomingPriceFiles(previous =>
              previous?.serial === serial ? null : previous)}
            onReviewedBaskets={onReviewedBaskets}
            onCaptureProgress={onCaptureProgress}
            focusReview={privateReviewFocus?.planKey === privatePlanKey ? privateReviewFocus : null}
          />
          </Suspense>
          </div>
        )}
        {tab === 'list' && (
          <nav className="screen" aria-label="Snelle acties voor je boodschappenlijst">
            <button type="button" className="ghost-button" onClick={() =>
              document.getElementById('supa-own-extra-groceries')?.scrollIntoView({
                behavior: 'smooth', block: 'start',
              })}>
              Voeg eigen boodschappen toe · zonder winkelprijs
            </button>
            <button type="button" className="ghost-button" onClick={openOwnPriceImport}>
              Open mijn PLUS/Deka-winkelvergelijking
            </button>
            <label className="supa-list-source-upload">
              <strong>Eigen winkelopname(s) direct openen</strong>
              <small>1 of 2 originele PLUS/DekaMarkt CSV, TSV, TXT of Supa JSON-bestanden.
                De import gaat via Vergelijk en vraagt daar altijd om eigen controle.</small>
              <input type="file" multiple
                accept=".csv,.tsv,.txt,.json,text/csv,text/plain,text/tab-separated-values,application/json"
                onChange={event => {
                  const files = Array.from(event.currentTarget.files ?? [])
                  event.currentTarget.value = ''
                  handoffOwnPriceFiles(files)
                }} />
            </label>
            {listSourceFileWarning &&
              <p role="alert" className="supa-list-source-upload__error">{listSourceFileWarning}</p>}
          </nav>
        )}
        {visitedList && !livePrivateReviewed && (
          <div hidden={tab !== 'list'} aria-hidden={tab !== 'list'}>
            <section className="screen" aria-label="Boodschappenlijst uit mijn eigen weekmenu">
              <UnpricedPlannerChecklist plan={plannedMeals} recipes={recipes} activeDays={activeDays}
                onOpenPriceImport={openOwnPriceImport} onOpenRecipes={() => navigate('recipes')} />
              {tab === 'list' && (designProductIds.length > 0
                ? <section aria-label="Mijn expliciet toegevoegde producten">
                    <h3>Mijn toegevoegde producten · apart van receptboodschappen</h3>
                    <p className="disclaimer">Deze selectie is door jou gemaakt in Producten.
                      Historische gegevens en Figma-voorbeelden zijn geen geverifieerde prijzen
                      en doen niet mee in een eigen winkelmandvergelijking.</p>
                    <HiFiDemoList ids={designProductIds} onRemove={toggleDesignProduct} />
                    <ShoppingListView basket={basket} />
                  </section>
                : <details className="demo-comparison-disclosure">
                    <summary>Toon oude voorbeeldboodschappen (geen actuele winkelprijzen)</summary>
                    <HiFiDemoList ids={designProductIds} onRemove={toggleDesignProduct} />
                    <ShoppingListView basket={basket} />
                  </details>)}
            </section>
          </div>
        )}
        {livePrivateReviewed && (
          <div hidden={tab !== 'list'} aria-hidden={tab !== 'list'}>
            <PrivateSourceShoppingList reviewed={livePrivateReviewed} budget={budget}
              checked={privateShoppingTicks} setChecked={setPrivateShoppingTicks}
              plan={plannedMeals} recipes={recipes} activeDays={activeDays}
              preferred={preferredOwnStore} onChooseStore={setPreferredOwnStore}
              onOpenComparison={openOwnPriceImport} routeOpenSignal={mixedRouteOpenSignal}
              routeChoice={privateRouteChoice}
              routeCostIntent={mixedCostIntent} />
          </div>
        )}
        {visitedList && (
          <div hidden={tab !== 'list'} aria-hidden={tab !== 'list'}>
            <Suspense fallback={<p role="status">Eigen gedeeltelijke bronproducten laden…</p>}>
              <PartialReviewedShoppingList
                progress={privateCaptureProgress?.planKey === privatePlanKey
                  ? privateCaptureProgress : null}
                complete={livePrivateReviewed}
                checked={privateShoppingTicks}
                setChecked={setPrivateShoppingTicks}
                onOpenComparison={openOwnPriceImport}
                onReviewIngredient={(store, ingredientId) => {
                  setPrivateReviewFocus(previous => ({
                    planKey: privatePlanKey, store, ingredientId,
                    serial: (previous?.serial ?? 0) + 1,
                  }))
                  navigate('basket')
                }}
              />
            </Suspense>
          </div>
        )}
        {tab === 'list' && livePrivateReviewed && designProductIds.length > 0 && (
          <section className="screen" aria-label="Extra zelf gekozen producten buiten het prijsmandje">
            <h3>Extra producten · niet meegerekend in jouw supermarktmand</h3>
            <p className="disclaimer">Jouw losse Producten-selectie is apart bewaard.
              Historische artikelen en Figma-voorbeelden zijn geen nieuwe bronprijzen,
              volledige verpakkingsmatches of besparingsbewijs.</p>
            <HiFiDemoList ids={designProductIds} onRemove={toggleDesignProduct} />
          </section>
        )}
        {tab === 'list' && (
          <section className="screen" aria-label="Persoonlijke extra boodschappen buiten het prijsmandje">
            <Suspense fallback={<p>Eigen ongeprijsde boodschappen openen…</p>}>
              <OwnExtraGroceries identity={privatePlanKey}
                plan={plannedMeals} recipes={recipes} activeDays={activeDays} />
            </Suspense>
          </section>
        )}
        {tab === 'observe' && <ObservationView />}
      </div>

      <nav className="bottom-nav hifi-nav" aria-label="Hoofdnavigatie">
        {tabs.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-label={item.label}
            className={tab === item.id ? 'active' : ''}
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => navigate(item.id)}
          >
            <FigmaImage asset={tab === "products" ? (originalProductNavIcons[item.id] ?? item.icon) : item.icon} alt="" />
            <span className="hifi-sr-only">{item.label}</span>
          </button>
        ))}
      </nav>
    </main>
  )
}
