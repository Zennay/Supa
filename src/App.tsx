import { FigmaImage } from './components/FigmaImage'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { PlannerView } from './features/planner/PlannerView'
import { WeekShareManualCopy } from './features/planner/WeekShareManualCopy'
import { currentWeekSharePreview, formatShareableWeek } from './features/planner/weekPlanShare'
import type { WeekSharePreview } from './features/planner/weekPlanShare'
import { BasketView, resolveStagedBasket } from './features/basket/BasketView'
import { ShoppingListView } from './features/shopping-list/ShoppingListView'
import { UnpricedPlannerShoppingList } from './features/shopping-list/UnpricedPlannerShoppingList.tsx'
import type { UnpricedShoppingNote } from './features/shopping-list/ManualShoppingNotes.tsx'
import { ObservationView } from './features/observation/ObservationView'
import { IdentityAvatar } from './components/IdentityAvatar.tsx'
import { HiFiHome, HiFiDemoList } from './features/home/HiFiHome'
import { readRecipeLibrary } from './features/recipes/recipeLibrary'
import { toPlannerRecipe } from './features/recipes/plannerRecipes'
import { curatedFigmaRecipes } from './features/recipes/curatedFigmaRecipes'
import { figmaAssets } from './features/home/figmaAssets'
import { buildOneStoreBasket } from './domain/basket'
import type { OfflinePriceSnapshots, OfflineRetailer } from './domain/offlineReviewedImport.ts'
import type { OfflineComparisonSession } from './features/comparison/offlineComparisonSession.ts'
import { compareFullBaskets } from './domain/basketComparison'
import {
  defaultPlannerPreferences,
  serializePlannerPreferences,
  type PlannerPreferences,
} from './domain/plannerPreferences'
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

const PlannerPortableWeek = lazy(() =>
  import('./features/planner/PlannerPortableWeek.tsx')
    .then(module => ({ default: module.PlannerPortableWeek }))
)

const OwnSourceProductLibrary = lazy(() =>
  import('./features/products/OwnSourceProductLibrary.tsx')
    .then(module => ({ default: module.OwnSourceProductLibrary }))
)

const PlannerActualTwoStoreSummary = lazy(() =>
  import('./features/planner/PlannerActualTwoStoreSummary.tsx')
    .then(module => ({ default: module.PlannerActualTwoStoreSummary }))
)

type Tab = 'home' | 'recipes' | 'products' | 'planner' | 'basket' | 'list' | 'observe'

const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: figmaAssets.imgVector5 },
  { id: 'planner', label: 'Planner', icon: figmaAssets.imgButton },
  { id: 'recipes', label: 'Recepten', icon: figmaAssets.imgButton1 },
  { id: 'products', label: 'Producten', icon: figmaAssets.imgButton2 },
  { id: 'list', label: 'Lijst', icon: figmaAssets.imgButton3 },
  { id: 'basket', label: 'Vergelijk', icon: figmaAssets.imgButton2 },
]

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
    return {
      preferences: restorePlannerPreferencesWithCustomBudget(raw, m2InitialPlan, validRecipeIds),
      warning: canReplacePlannerRecord(raw, m2InitialPlan.map((meal) => meal.day), validRecipeIds)
        ? null : 'protected',
      raw,
    }
  } catch {
    return { preferences: fallback, warning: 'unavailable', raw: null }
  }
}

/** Private local data lives in the App, not in tabs that unmount on navigation.
 * These are React-memory-only hooks; no automatic storage or network upload. */
function useOfflineComparisonSession(): OfflineComparisonSession {
  const [selectedStore, setSelectedStore] = useState<OfflineRetailer>('PLUS')
  const [reviewTarget, setReviewTarget] = useState<{
    store: OfflineRetailer; ingredientId: string
  } | null>(null)
  const [text, setText] = useState('')
  const [imported, setImported] = useState<OfflinePriceSnapshots | null>(null)
  const [stagedCaptures, setStagedCaptures] = useState<
    Partial<Record<OfflineRetailer, Record<string, unknown>>>
  >({})
  const [manualSelections, setManualSelections] = useState<{
    fingerprint: string
    products: Record<string, string>
  }>({ fingerprint: '', products: {} })
  const [stagedManual, setStagedManual] = useState<Record<
    OfflineRetailer, { fingerprint: string; products: Record<string, string> }
  >>({
    PLUS: { fingerprint: '', products: {} },
    DekaMarkt: { fingerprint: '', products: {} },
  })
  // Explicit user-selected extras are outside the calculated same-demand basket.
  const [extraProductIds, setExtraProductIds] = useState<Record<OfflineRetailer, string[]>>({
    PLUS: [], DekaMarkt: [],
  })
  const [extraDoneIds, setExtraDoneIds] = useState<Record<OfflineRetailer, string[]>>({
    PLUS: [], DekaMarkt: [],
  })
  // Private loose-product pack counts, separate from matched meal baskets.
  const [extraQuantities, setExtraQuantities] = useState<
    Record<OfflineRetailer, Record<string, number>>
  >({ PLUS: {}, DekaMarkt: {} })
  const [tripMemory, setTripMemory] = useState<
    Partial<Record<OfflineRetailer, { identity: string; done: string[] }>>
  >({})
  const [importEpoch, setImportEpoch] = useState(0)
  return {
    selectedStore, setSelectedStore, reviewTarget, setReviewTarget,
    text, setText, imported, setImported,
    stagedCaptures, setStagedCaptures, manualSelections, setManualSelections, stagedManual, setStagedManual,
    tripMemory, setTripMemory, extraProductIds, setExtraProductIds,
    extraDoneIds, setExtraDoneIds, extraQuantities, setExtraQuantities,
    importEpoch, setImportEpoch,
  }
}

export function App({ initialTab = 'home' }: { initialTab?: Tab } = {}) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [sourceClock, setSourceClock] = useState(() => Date.now())
  const [unpricedNotes, setUnpricedNotes] = useState<UnpricedShoppingNote[]>([])
  const [unpricedWeekProgress, setUnpricedWeekProgress] = useState<{
    identity: string; done: string[]
  }>({ identity: '', done: [] })
  // The established shopping route remains independently loadable. Only the
  // optional local notes editor is code-split when the user actually opens List.
  const [privateNotesView, setPrivateNotesView] = useState<
    typeof import('./features/shopping-list/ManualShoppingNotes.tsx').ManualShoppingNotes | null
  >(null)
  const [privateNotesLoadError, setPrivateNotesLoadError] = useState(false)
  useEffect(() => {
    if (tab !== 'list' || privateNotesView || privateNotesLoadError) return
    let active = true
    void import('./features/shopping-list/ManualShoppingNotes.tsx')
      .then(({ ManualShoppingNotes }) => {
        if (active) setPrivateNotesView(() => ManualShoppingNotes)
      })
      .catch(() => { if (active) setPrivateNotesLoadError(true) })
    return () => { active = false }
  }, [tab, privateNotesView, privateNotesLoadError])

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window.setInterval !== 'function') return
    const refresh = () => setSourceClock(Date.now())
    const timer = window.setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  const offlinePriceSession = useOfflineComparisonSession()
  // Volatile choices are cleared by explicit source replacement/discard in
  // the canonical importer. An empty pair is not a discard: one-store staging
  // and in-progress file reads must not wipe valid shopping progress.
  const [initialProductSelection] = useState(readChosenProducts)
  const [designProductIds, setDesignProductIds] = useState<string[]>(() => initialProductSelection.ids)
  const [savedProductRaw, setSavedProductRaw] = useState(initialProductSelection.raw)
  const [productSelectionTouched, setProductSelectionTouched] = useState(false)
  const [productSelectionWarning, setProductSelectionWarning] = useState<'protected' | 'unavailable' | null>(
    () => initialProductSelection.writable ? null : (typeof window === 'undefined' ? null : 'protected'),
  )
  const isHiFiView = tab === 'home' || tab === 'recipes' || tab === 'products'
  const navigate = (next: Tab) => { setTab(next); window.scrollTo?.(0, 0) }
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
  const [manualWeekCopy, setManualWeekCopy] = useState<WeekSharePreview | null>(null)
  const [includeWeekBudget, setIncludeWeekBudget] = useState(false)
  const [includeWeekDetails, setIncludeWeekDetails] = useState(false)
  const [weekCopyMessage, setWeekCopyMessage] = useState('')
  const { budget, activeDays, recipeByDay } = preferences

  const plannedMeals = useMemo(() => {
    const available = new Set(recipes.map(recipe => recipe.id))
    return m2InitialPlan.map(meal => {
      const chosen = recipeByDay[meal.day] ?? meal.recipeId
      // A deleted or no-longer-reviewable own recipe is not a phantom meal.
      // Use the real built-in default without pricing missing ingredients.
      return { ...meal, recipeId: available.has(chosen) ? chosen : meal.recipeId }
    })
  }, [recipeByDay, recipes])

  // Bind prepared copy to the exact user-visible plan state. Clearing it in
  // an effect alone happens after render and briefly exposes stale personal text.
  const shareSourceKey = JSON.stringify([
    plannedMeals,
    activeDays,
    budget,
    includeWeekBudget,
    includeWeekDetails,
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

  const importedPair = useMemo(() => {
    const imported = offlinePriceSession.imported
    if (!imported) return null
    try {
      // Keep the exact comparison identity used by the imported product picker.
      const identity = JSON.stringify([
        plannedMeals, activeDays,
        recipes.map(recipe => [recipe.id, recipe.ingredients]),
        ...(['PLUS', 'DekaMarkt'] as const).map(store => [
          imported.captures[store].observedAt, imported.captures[store].products,
        ]),
      ])
      const choices = offlinePriceSession.manualSelections.fingerprint === identity
        ? offlinePriceSession.manualSelections.products : {}
      const basketFor = (store: 'PLUS' | 'DekaMarkt') => {
        const prefix = store + '\u0000'
        const manualProductIds = Object.fromEntries(
          Object.entries(choices).filter(([id]) => id.startsWith(prefix))
            .map(([id, productId]) => [id.slice(prefix.length), productId]),
        )
        return buildOneStoreBasket({
          store: { id: store, name: store }, plan: plannedMeals, recipes, activeDays,
          products: imported.captures[store].products, manualProductIds,
        })
      }
      return { plus: basketFor('PLUS'), deka: basketFor('DekaMarkt') }
    } catch { return null }
  }, [offlinePriceSession.imported, offlinePriceSession.manualSelections, plannedMeals, recipes, activeDays])
  const importedSourceFresh = useMemo(() => {
    const imported = offlinePriceSession.imported
    if (!imported) return false
    try {
      const plus = imported.captures.PLUS.observedNs
      const deka = imported.captures.DekaMarkt.observedNs
      const oldest = plus < deka ? plus : deka
      const newest = plus > deka ? plus : deka
      const now = BigInt(Math.trunc(sourceClock)) * 1_000_000n
      return now >= newest - 300_000_000_000n &&
        now - oldest <= 604_800_000_000_000n
    } catch { return false }
  }, [offlinePriceSession.imported, sourceClock])
  // A valid recent single-store meal basket stays usable even if the OTHER
  // capture expired. Never extend the freshness of the two-store comparison.
  const selectedImportedStoreFresh = useMemo(() => {
    const source = offlinePriceSession.imported?.captures[offlinePriceSession.selectedStore]
    if (!source) return false
    const now = BigInt(Math.trunc(sourceClock)) * 1_000_000n
    return now >= source.observedNs - 300_000_000_000n &&
      now - source.observedNs <= 604_800_000_000_000n
  }, [offlinePriceSession.imported, offlinePriceSession.selectedStore, sourceClock])
  const currentStoreBasket = importedPair
    ? offlinePriceSession.selectedStore === 'PLUS' ? importedPair.plus : importedPair.deka
    : null

  // One-store captures can already price their OWN selected-week demand.
  // Never synthesize a second retailer, compare staged baskets or reuse old
  // manual choices after the source or Planner changes.
  const stagedRetailers = (['PLUS', 'DekaMarkt'] as const).filter(
    store => !!offlinePriceSession.stagedCaptures[store],
  )
  const stagedForPlanner = useMemo(() => {
    if (offlinePriceSession.imported) return null
    const store = offlinePriceSession.stagedCaptures[offlinePriceSession.selectedStore]
      ? offlinePriceSession.selectedStore : stagedRetailers[0]
    if (!store || typeof resolveStagedBasket !== 'function') return null
    // Resolve through the existing BasketView-owned canonical local importer,
    // not through an additional eager App runtime dependency.
    return resolveStagedBasket(offlinePriceSession, store, plannedMeals,
      recipes, activeDays, sourceClock)
  }, [offlinePriceSession.imported, offlinePriceSession.stagedCaptures,
    offlinePriceSession.selectedStore, offlinePriceSession.stagedManual,
    plannedMeals, recipes, activeDays, sourceClock])
  const plannerBasket = currentStoreBasket ?? stagedForPlanner?.basket ?? null
  const plannerSource = offlinePriceSession.imported
    ? !selectedImportedStoreFresh ? 'expired'
      : currentStoreBasket && currentStoreBasket.selectedMealCount > 0 &&
        currentStoreBasket.lines.length > 0 ? 'private' : 'empty'
    : stagedForPlanner
      ? !stagedForPlanner.fresh ? 'expired'
        : stagedForPlanner.basket.selectedMealCount > 0 &&
          stagedForPlanner.basket.lines.length > 0 ? 'private' : 'empty'
      : stagedRetailers.length > 0 ? 'empty' : 'example'
  const plannerStore = offlinePriceSession.imported
    ? offlinePriceSession.selectedStore : stagedForPlanner?.store

  const privateHomeSummary = useMemo(() => {
    const source = offlinePriceSession.imported
    if (!source || !importedPair || !currentStoreBasket) {
      if (!stagedForPlanner) return null
      const lone = stagedForPlanner.basket
      return {
        selectedStore: stagedForPlanner.store,
        matched: lone.matchedLineCount,
        unresolved: lone.unresolvedLineCount,
        hasDemand: lone.selectedMealCount > 0 && lone.lines.length > 0,
        complete: lone.selectedMealCount > 0 && lone.lines.length > 0 &&
          lone.unresolvedLineCount === 0,
        fresh: stagedForPlanner.fresh,
        pairFresh: false,
        pairedWithin24h: false,
        totalCents: lone.totalCents,
        deltaCents: null,
        paired: false,
      }
    }
    const complete = (value: typeof importedPair.plus) =>
      value.selectedMealCount > 0 && value.lines.length > 0 && value.unresolvedLineCount === 0
    const ownComparison = compareFullBaskets({
      baseline: importedPair.plus, candidate: importedPair.deka,
    })
    const comparable = importedSourceFresh && source.pairedWithin24h &&
      complete(importedPair.plus) && complete(importedPair.deka) &&
      ownComparison.claimable && ownComparison.deltaCents !== null
    return {
      selectedStore: offlinePriceSession.selectedStore,
      matched: currentStoreBasket.matchedLineCount,
      unresolved: currentStoreBasket.unresolvedLineCount,
      hasDemand: currentStoreBasket.selectedMealCount > 0 && currentStoreBasket.lines.length > 0,
      complete: complete(currentStoreBasket),
      fresh: selectedImportedStoreFresh,
      pairFresh: importedSourceFresh,
      pairedWithin24h: source.pairedWithin24h,
      totalCents: currentStoreBasket.totalCents,
      deltaCents: comparable ? ownComparison.deltaCents : null,
      paired: true,
    }
  }, [offlinePriceSession.imported, offlinePriceSession.selectedStore, importedPair,
    importedSourceFresh, selectedImportedStoreFresh, currentStoreBasket, stagedForPlanner])

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

  const planOwnRecipe = (recipeId: string, day: string) => {
    // Selection is always explicit: it chooses one existing day and an already
    // reviewed recipe; neither retailer observations nor prices are changed.
    if (!recipes.some(recipe => recipe.id === recipeId) ||
        !m2InitialPlan.some(meal => meal.day === day)) return
    setPreferences(current => ({ ...current,
      activeDays: current.activeDays.includes(day) ? current.activeDays : [...current.activeDays, day],
      recipeByDay: { ...current.recipeByDay, [day]: recipeId },
    }))
    navigate('planner')
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
        {tab === 'products' && (
          <Suspense fallback={<p role="status">Mijn eigen bronartikelen openen…</p>}>
            <OwnSourceProductLibrary
              source={offlinePriceSession.imported}
              baskets={importedPair}
              nowMs={sourceClock}
              onCompare={() => navigate('basket')}
              onList={(shop) => {
                offlinePriceSession.setSelectedStore(shop)
                navigate('list')
              }}
            />
          </Suspense>
        )}
        {isHiFiView && <HiFiHome view={tab as 'home' | 'recipes' | 'products'} onNavigate={navigate} activeDays={activeDays} addedProducts={designProductIds} onToggleProduct={toggleDesignProduct} onPlanRecipe={planOwnRecipe} priceSession={offlinePriceSession}
          privateSummary={privateHomeSummary ?? undefined} />}
        {!isHiFiView && <nav className="hifi-utilities" aria-label="Vergelijken en meten"><button onClick={() => navigate('basket')}>Mand</button><button onClick={() => navigate('observe')}>Meten</button></nav>}
        {tab === 'list' && offlinePriceSession.imported && (
          <BasketView basket={basket} comparison={basketComparison}
            comparisonBaseline={comparisonBaseline} comparisonCandidate={comparisonCandidate}
            manualPlan={plannedMeals} manualRecipes={recipes} manualActiveDays={activeDays}
            manualWeekBudgetEuros={budget} offlinePriceSession={offlinePriceSession}
            displayLocalList onOpenComparison={() => navigate('basket')}
          />
        )}
        {tab === 'list' && !offlinePriceSession.imported && stagedRetailers.length > 0 && (
          <BasketView basket={basket} comparison={basketComparison}
            comparisonBaseline={comparisonBaseline} comparisonCandidate={comparisonCandidate}
            manualPlan={plannedMeals} manualRecipes={recipes} manualActiveDays={activeDays}
            manualWeekBudgetEuros={budget} offlinePriceSession={offlinePriceSession}
            displayStagedOnly onOpenComparison={() => navigate('basket')}
          />
        )}
        {tab === 'list' && !offlinePriceSession.imported && stagedRetailers.length === 0 && (
          <UnpricedPlannerShoppingList
            plan={plannedMeals} recipes={recipes} activeDays={activeDays}
            progress={unpricedWeekProgress} setProgress={setUnpricedWeekProgress}
            onOpenPlanner={() => navigate('planner')}
            onOpenCompare={() => navigate('basket')}
          />
        )}
        {tab === 'list' && (privateNotesView
          ? (() => {
              const PrivateNotes = privateNotesView
              const store = offlinePriceSession.selectedStore
              const capture = offlinePriceSession.imported?.captures[store]
              // Never export the other retailer's planner fallback as a priced
              // basket when the user chooses a shop without an imported source.
              const ownBasket = capture
                ? (store === 'PLUS' ? importedPair?.plus : importedPair?.deka) ?? null
                : stagedForPlanner?.store === store ? stagedForPlanner.basket : null
              const nowNs = BigInt(Math.trunc(sourceClock)) * 1_000_000n
              const storeFresh = capture
                ? nowNs >= capture.observedNs - 300_000_000_000n &&
                  nowNs - capture.observedNs <= 604_800_000_000_000n
                : stagedForPlanner?.store === store && stagedForPlanner.fresh === true
              const extras = capture ? capture.products
                .filter(product => offlinePriceSession.extraProductIds[store].includes(product.id))
                .map(product => ({
                  name: product.name,
                  packs: offlinePriceSession.extraQuantities[store][product.id] ?? 1,
                  done: offlinePriceSession.extraDoneIds[store].includes(product.id),
                })) : []
              return <PrivateNotes notes={unpricedNotes} setNotes={setUnpricedNotes}
                storeBasket={ownBasket} activeStore={store}
                onSelectCombinedStore={offlinePriceSession.setSelectedStore}
                sourceFresh={storeFresh} ownExtras={extras}
                observedAt={capture?.observedAt ??
                  (typeof offlinePriceSession.stagedCaptures[store]?.observedAt === 'string'
                    ? offlinePriceSession.stagedCaptures[store].observedAt as string : null)}
                tripProgress={offlinePriceSession.tripMemory[store]} />
            })()
          : <p role="status">{privateNotesLoadError
              ? 'Eigen ongeprijsde lijst kon niet worden geopend; je bestaande mandjes zijn behouden.'
              : 'Eigen ongeprijsde lijst openen…'}</p>)}
        {tab === 'list' && <p className="disclaimer">
          Eigen boodschappen staan bovenaan. De oorspronkelijke Figma-demoproducten
          en voorbeeldprijzen zijn apart verborgen; ze worden nooit als huidige
          winkelprijs of geverifieerde besparing gebruikt.
        </p>}
        {tab === 'list' && <section className="demo-comparison-disclosure"
          aria-label="Oorspronkelijke niet-actuele ontwerpvoorbeelden">
          <h3>Ontwerpvoorbeelden · geen actuele winkelprijzen</h3>
          <p className="disclaimer">Je in Producten gekozen Figma-voorbeelden staan hier
            los van je eigen weekmand en PLUS/DekaMarkt-prijsvergelijking.</p>
          <HiFiDemoList ids={designProductIds} onRemove={toggleDesignProduct} />
        </section>}
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
            basketTotalCents={plannerSource === 'private' && plannerBasket ? plannerBasket.totalCents : basket.totalCents}
            basketUnresolvedLineCount={plannerSource === 'private' && plannerBasket ? plannerBasket.unresolvedLineCount : basket.unresolvedLineCount}
            priceSource={plannerSource}
            priceStore={plannerSource === 'private' ? plannerStore : undefined}
            onOpenComparison={() => navigate('basket')}
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
        {tab === 'planner' && importedPair && offlinePriceSession.imported && (
          <Suspense fallback={<p role="status">Eigen winkelmandjes openen…</p>}>
            <PlannerActualTwoStoreSummary
              plus={importedPair.plus}
              deka={importedPair.deka}
              comparison={compareFullBaskets({ baseline: importedPair.plus, candidate: importedPair.deka })}
              source={offlinePriceSession.imported}
              fresh={importedSourceFresh}
              budget={budget}
              onOpen={() => navigate('basket')}
            />
          </Suspense>
        )}
        {tab === 'planner' && (
          <Suspense fallback={<p role="status">Privé weekplanning laden…</p>}>
            <PlannerPortableWeek
              preferences={preferences}
              days={m2InitialPlan.map(meal => meal.day)}
              recipeIds={validRecipeIds}
              recipeNames={Object.fromEntries(recipes.map(recipe => [recipe.id, recipe.title]))}
              onRestore={(restored) => {
                if (!persistenceWarning) setPreferences(restored)
              }}
              storageProtected={persistenceWarning !== null}
            />
          </Suspense>
        )}
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
        {tab === 'basket' && (
          <BasketView
            basket={basket}
            comparison={basketComparison}
            comparisonBaseline={comparisonBaseline}
            comparisonCandidate={comparisonCandidate}
            manualPlan={plannedMeals}
            manualRecipes={recipes}
            manualActiveDays={activeDays}
            manualWeekBudgetEuros={budget}
            offlinePriceSession={offlinePriceSession}
            onOpenList={() => navigate('list')}
            onOpenPlanner={() => navigate('planner')}
          />
        )}
        {tab === 'list' && offlinePriceSession.imported && <details className="demo-comparison-disclosure">
          <summary>Oude voorbeeldboodschappenlijst (niet de geïmporteerde mand)</summary>
          {tab === 'list' && <ShoppingListView basket={basket} />}
        </details>}
        {tab === 'list' && !offlinePriceSession.imported && stagedRetailers.length === 0 && (
          <section className="demo-comparison-disclosure"
            aria-label="Oude voorbeeldmand zonder actuele winkelprijzen">
            <h3>Voorbeeldmand · geen actuele winkelprijzen</h3>
            <p className="disclaimer">De oude ontwerpmand gebruikt fictieve voorbeelddata.
              Alleen je eigen boodschappen bovenaan en uitdrukkelijk geïmporteerde
              bronopnames kunnen voor je echte winkeltrip worden gebruikt.</p>
            <ShoppingListView basket={basket} />
          </section>
        )}
        {tab === 'list' && !offlinePriceSession.imported && stagedRetailers.length > 0 && (
          <details className="demo-comparison-disclosure">
            <summary>Oude voorbeeldboodschappenlijst (geen eigen prijsdata)</summary>
            <ShoppingListView basket={basket} />
          </details>
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
            <FigmaImage asset={item.icon} alt="" />
            <span className="hifi-sr-only">{item.label}</span>
          </button>
        ))}
      </nav>
    </main>
  )
}
