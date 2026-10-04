import { useMemo, useState } from 'react'
import { PlannerView } from './features/planner/PlannerView'
import { BasketView } from './features/basket/BasketView'
import { ShoppingListView } from './features/shopping-list/ShoppingListView'
import { buildOneStoreBasket } from './domain/basket'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from './data/m2Fixture'

type Tab = 'planner' | 'basket' | 'list'

const tabs: { id: Tab; label: string }[] = [
  { id: 'planner', label: 'Planner' },
  { id: 'basket', label: 'Mand' },
  { id: 'list', label: 'Lijst' },
]

export function App() {
  const [tab, setTab] = useState<Tab>('planner')
  const [budget, setBudget] = useState(35)
  const [activeDays, setActiveDays] = useState<string[]>(m2DefaultActiveDays)
  const [plannedMeals, setPlannedMeals] = useState(() =>
    m2InitialPlan.map((meal) => ({ ...meal })),
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

  const toggleDay = (day: string) => {
    setActiveDays((current) =>
      current.includes(day)
        ? current.filter((candidate) => candidate !== day)
        : [...current, day],
    )
  }

  const changeRecipe = (day: string, recipeId: string) => {
    setPlannedMeals((current) =>
      current.map((meal) => (meal.day === day ? { ...meal, recipeId } : meal)),
    )
  }

  const resetPlan = () => {
    setBudget(35)
    setActiveDays(m2DefaultActiveDays)
    setPlannedMeals(m2InitialPlan.map((meal) => ({ ...meal })))
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
            onBudgetChange={setBudget}
            onToggleDay={toggleDay}
            onRecipeChange={changeRecipe}
            onReset={resetPlan}
          />
        )}
        {tab === 'basket' && <BasketView basket={basket} />}
        {tab === 'list' && <ShoppingListView basket={basket} />}
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
