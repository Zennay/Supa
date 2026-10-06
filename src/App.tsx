import { useEffect, useMemo, useState } from 'react'
import { PlannerView } from './features/planner/PlannerView'
import { BasketView } from './features/basket/BasketView'
import { ShoppingListView } from './features/shopping-list/ShoppingListView'
import { ObservationView } from './features/observation/ObservationView'
import { buildOneStoreBasket } from './domain/basket'
import { compareFullBaskets } from './domain/basketComparison'
import {
  defaultPlannerPreferences,
  parsePlannerPreferences,
  serializePlannerPreferences,
} from './domain/plannerPreferences'
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

function readPlannerPreferences() {
  if (typeof window === 'undefined') {
    return defaultPlannerPreferences(m2InitialPlan)
  }

  try {
    return parsePlannerPreferences(
      window.localStorage.getItem(plannerStorageKey),
      m2InitialPlan,
      validRecipeIds,
    )
  } catch {
    return defaultPlannerPreferences(m2InitialPlan)
  }
}

export function App() {
  const [tab, setTab] = useState<Tab>('planner')
  const [preferences, setPreferences] = useState(readPlannerPreferences)
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

    try {
      window.localStorage.setItem(
        plannerStorageKey,
        serializePlannerPreferences(preferences),
      )
    } catch {
      // Strict privacy modes can deny storage; the active session remains usable.
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
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </main>
  )
}
