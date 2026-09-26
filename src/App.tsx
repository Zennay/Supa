import { useState } from 'react'
import { PlannerView } from './features/planner/PlannerView'
import { BasketView } from './features/basket/BasketView'
import { ShoppingListView } from './features/shopping-list/ShoppingListView'

type Tab = 'planner' | 'basket' | 'list'

const tabs: { id: Tab; label: string }[] = [
  { id: 'planner', label: 'Planner' },
  { id: 'basket', label: 'Mand' },
  { id: 'list', label: 'Lijst' },
]

export function App() {
  const [tab, setTab] = useState<Tab>('planner')

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
        {tab === 'planner' && <PlannerView />}
        {tab === 'basket' && <BasketView />}
        {tab === 'list' && <ShoppingListView />}
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
