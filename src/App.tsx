import { useEffect, useMemo, useState } from 'react'
import { PlannerView } from './features/planner/PlannerView'
import { BasketView } from './features/basket/BasketView'
import { ShoppingListView } from './features/shopping-list/ShoppingListView'
import { ObservationView } from './features/observation/ObservationView'
import { buildOneStoreBasket } from './domain/basket'
import { compareFullBaskets } from './domain/basketComparison'
import {
  defaultPlannerPreferences,
  serializePlannerPreferences,
  type PlannerPreferences,
} from './domain/plannerPreferences'
import { restorePlannerPreferencesWithCustomBudget } from './features/planner/customWeekBudget.ts'
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

type Tab = 'planner' | 'basket' | 'list' | 'observe'

const tabs: { id: Tab; label: string }[] = [
  { id: 'planner', label: 'Planner' },
  { id: 'basket', label: 'Mand' },
  { id: 'list', label: 'Lijst' },
  { id: 'observe', label: 'Meten' },
]

const plannerStorageKey = 'supa:planner-preferences:v2'
const validRecipeIds = m2Recipes.map((recipe) => recipe.id)

type PersistenceWarning = 'unavailable' | 'protected' | null

// Only the exact established v2 envelope may be normalized/rewritten.
// Unknown future/corrupt data must survive untouched until reviewed.
function canReplacePlannerRecord(raw: string | null): boolean {
  if (raw === null) return true
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const object = value as Record<string, unknown>
    const allowed = ['budget', 'activeDays', 'recipeByDay']
    if (!allowed.every((key) => Object.hasOwn(object, key))) return false
    if (!Object.keys(object).every((key) => allowed.includes(key))) return false
    // Numeric JSON is not necessarily a valid persisted weekbudget.
    // Check a cent-exact positive value in the advertised €0,01–€1.000,00
    // range without rounding an invalid stored value into user consent.
    const isCanonicalIdentifier = (value: unknown): value is string =>
      typeof value === 'string' && value.length > 0 && value === value.trim()
    const budget = object.budget
    const budgetCents = typeof budget === 'number' && Number.isFinite(budget)
      ? Math.round(budget * 100)
      : NaN
    return (
      Number.isSafeInteger(budgetCents) &&
      budgetCents >= 1 &&
      budgetCents <= 100_000 &&
      budget === budgetCents / 100 &&
      Array.isArray(object.activeDays) &&
      object.activeDays.every(isCanonicalIdentifier) &&
      new Set(object.activeDays).size === object.activeDays.length &&
      object.recipeByDay !== null &&
      typeof object.recipeByDay === 'object' &&
      !Array.isArray(object.recipeByDay) &&
      Object.keys(object.recipeByDay).every(isCanonicalIdentifier) &&
      Object.values(object.recipeByDay).every(isCanonicalIdentifier)
    )
  } catch {
    return false
  }
}

function readPlannerPreferences(): {
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
      preferences: restorePlannerPreferencesWithCustomBudget(
        raw, m2InitialPlan, validRecipeIds,
      ),
      warning: canReplacePlannerRecord(raw) ? null : 'protected',
      raw,
    }
  } catch {
    return { preferences: fallback, warning: 'unavailable', raw: null }
  }
}

export function App() {
  const [tab, setTab] = useState<Tab>('planner')
  const [initialLoad] = useState(readPlannerPreferences)
  const [preferences, setPreferences] = useState(() => initialLoad.preferences)
  const [persistenceWarning, setPersistenceWarning] = useState<PersistenceWarning>(
    initialLoad.warning,
  )
  const [lastStoredRaw, setLastStoredRaw] = useState(initialLoad.raw)
  const { budget, activeDays, recipeByDay } = preferences

  const plannedMeals = useMemo(
    () =>
      m2InitialPlan.map((meal) => ({
        ...meal,
        recipeId: recipeByDay[meal.day] ?? meal.recipeId,
      })),
    [recipeByDay],
  )

  const basket = useMemo(
    () =>
      buildOneStoreBasket({
        store: m2Store,
        plan: plannedMeals,
        recipes: m2Recipes,
        activeDays,
        products: m2Products,
      }),
    [activeDays, plannedMeals],
  )

  const comparisonBaseline = useMemo(
    () =>
      buildOneStoreBasket({
        store: m3BaselineStore,
        plan: plannedMeals,
        recipes: m2Recipes,
        activeDays,
        products: m3BaselineProducts,
      }),
    [activeDays, plannedMeals],
  )

  const comparisonCandidate = useMemo(
    () =>
      buildOneStoreBasket({
        store: m3CandidateStore,
        plan: plannedMeals,
        recipes: m2Recipes,
        activeDays,
        products: m3CandidateProducts,
      }),
    [activeDays, plannedMeals],
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
    // Do not turn a failed initial read into an unrequested overwrite of
    // existing preferences. Retry only after a deliberate planner edit.
    if (initialLoad.warning && preferences === initialLoad.preferences) return

    try {
      const stored = window.localStorage.getItem(plannerStorageKey)
      // This is a pre-write check, not an atomic cross-tab CAS transaction.
      if (!canReplacePlannerRecord(stored) ||
          (stored !== null && stored !== lastStoredRaw)) {
        setPersistenceWarning('protected')
        return
      }
      const serialized = serializePlannerPreferences(preferences)
      window.localStorage.setItem(plannerStorageKey, serialized)
      setLastStoredRaw(serialized)
      setPersistenceWarning(null)
    } catch {
      // Keep changes usable in this session without pretending they are saved.
      setPersistenceWarning('unavailable')
    }
  }, [preferences])

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
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="brand-mark">S</span>
          <strong>SUPA</strong>
        </div>
        <button className="avatar" aria-label="Profiel">ZE</button>
      </header>

      <div className="content">
        {persistenceWarning && (
          <p role="alert" className="disclaimer">
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
            recipes={m2Recipes}
            basketTotalCents={basket.totalCents}
            basketUnresolvedLineCount={basket.unresolvedLineCount}
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
        {tab === 'basket' && (
          <BasketView
            basket={basket}
            comparison={basketComparison}
            comparisonBaseline={comparisonBaseline}
            comparisonCandidate={comparisonCandidate}
          />
        )}
        {tab === 'list' && <ShoppingListView basket={basket} />}
        {tab === 'observe' && <ObservationView />}
      </div>

      <nav className="bottom-nav" aria-label="Hoofdnavigatie">
        {tabs.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? 'active' : ''}
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </main>
  )
}
