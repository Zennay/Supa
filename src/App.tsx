import { useEffect, useMemo, useState } from 'react'
import { PlannerView } from './features/planner/PlannerView'
import { formatShareableWeek } from './features/planner/weekPlanShare'
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
  const [manualWeekCopy, setManualWeekCopy] = useState<string | null>(null)
  const [weekCopyMessage, setWeekCopyMessage] = useState('')
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

  useEffect(() => {
    // The export belongs to one exact plan snapshot; don't keep a stale draft
    // visible after the user changes the plan or budget.
    setManualWeekCopy(null)
    setWeekCopyMessage('')
  }, [preferences])

  const copyWeekPlan = async () => {
    let text: string
    try {
      text = formatShareableWeek({ plannedMeals, activeDays, recipes: m2Recipes, budget })
    } catch {
      setManualWeekCopy(null)
      setWeekCopyMessage('Weekmenu niet beschikbaar')
      return
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        setManualWeekCopy(null)
        setWeekCopyMessage('Weekmenu gekopieerd')
        return
      } catch {
        // On restricted browsers offer the actual text to copy manually.
      }
    }
    setManualWeekCopy(text)
    setWeekCopyMessage('Selecteer de tekst hieronder om te kopiëren')
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
          <section className="week-share-panel" aria-label="Weekmenu delen">
            <div className="week-share-actions">
              <span>Deel je geselecteerde maaltijden zonder prijzen.</span>
              <button type="button" className="ghost-button" onClick={copyWeekPlan}>
                Kopieer weekmenu
              </button>
            </div>
            <p role="status" aria-live="polite">{weekCopyMessage}</p>
            {manualWeekCopy !== null && (
              <div className="week-share-manual">
                <label htmlFor="week-share-text">Weekmenu om handmatig te kopiëren</label>
                <textarea
                  id="week-share-text"
                  readOnly
                  rows={Math.min(activeDays.length + 6, 14)}
                  value={manualWeekCopy}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </div>
            )}
          </section>
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
